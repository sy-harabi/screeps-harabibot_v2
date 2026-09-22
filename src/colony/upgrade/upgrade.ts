import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { fillAreaWithCreeps } from "../../capabilities/movement/fillAreaWithCreeps"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, TickContext } from "../../kernel/tickContext"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import { LogisticsState } from "../logistics/logistics"
import { createUpgraderBody } from "./upgrader"

interface UpgradeRuntime {
  rcl?: number
  area?: RoomCoordinate[]
}

const upgradeRuntimes = runtimeRegistry.createCache<string, UpgradeRuntime>("upgrade")

export const UPGRADER_ROLE = "upgrader"

export function runUpgrade(
  colonyName: string,
  room: Room,
  basePlan: BasePlan,
  context: TickContext,
  logistics: LogisticsState,
): void {
  const controller = room.controller

  if (!controller) {
    return
  }

  const upgraders = getColonyCreeps(context, colonyName, UPGRADER_ROLE)
  const upgradeArea = getUpgradeArea(colonyName, basePlan, controller.level)

  if (upgradeArea.length === 0) {
    return
  }

  const spawnedUpgraders = upgraders.filter((creep) => !creep.spawning)

  const fillArea = upgradeArea.slice(0, Math.min(spawnedUpgraders.length, upgradeArea.length))

  fillAreaWithCreeps(colonyName, fillArea, spawnedUpgraders)

  let effectiveWork = 0
  let effectiveUpgraders = 0

  for (const upgrader of upgraders) {
    const replacementLeadTime = upgrader.body.length * CREEP_SPAWN_TIME + 20

    if ((upgrader.ticksToLive ?? CREEP_LIFE_TIME) <= replacementLeadTime) {
      continue
    }

    effectiveWork += upgrader.getActiveBodyparts(WORK)
    effectiveUpgraders++
  }

  const targetWork = getTargetUpgradeWork(room)

  if (effectiveWork < targetWork && effectiveUpgraders < upgradeArea.length) {
    const workNeeded = targetWork - effectiveWork

    requestSpawn(
      {
        requesterId: `upgrade:${colonyName}`,
        spawnRoomName: colonyName,
        assignment: {
          type: "colony",
          colonyName,
        },
        priorityType: "upgrade",
        order: 0,
        rolesByPriority: [UPGRADER_ROLE],
      },
      () => createUpgraderBody(colonyName, workNeeded),
      UPGRADER_ROLE,
    )
  }
}

function getTargetUpgradeWork(room: Room): number {
  const level = room.controller?.level

  if (level === undefined) {
    return 0
  }

  if (level === 1) {
    return 5
  }

  if (level === 8) {
    return CONTROLLER_MAX_UPGRADE_PER_TICK
  }

  return 10
}

function getUpgradeArea(roomName: string, basePlan: BasePlan, rcl: number): readonly RoomCoordinate[] {
  const runtime = getUpgradeRuntime(roomName)

  if (runtime.rcl === rcl && runtime.area !== undefined) {
    return runtime.area
  }

  const area = createUpgradeArea(basePlan, rcl)

  runtime.rcl = rcl
  runtime.area = area

  return area
}

export function getUpgradeRuntime(colonyName: string): UpgradeRuntime {
  let runtime = upgradeRuntimes.get(colonyName)

  if (runtime === undefined) {
    runtime = {}
    upgradeRuntimes.set(colonyName, runtime)
  }

  return runtime
}

function createUpgradeArea(basePlan: BasePlan, rcl: number): RoomCoordinate[] {
  const { left, middle, right } = basePlan.controller.upgradeChains
  const chains = [middle, left, right].filter((chain) => isChainAvailable(chain, basePlan, rcl))

  const area: RoomCoordinate[] = []
  const maxLength = Math.max(...chains.map((chain) => chain.length), 0)

  for (let depth = 0; depth < maxLength; depth++) {
    for (const chain of chains) {
      const pos = chain[depth]

      if (pos !== undefined) {
        area.push(pos)
      }
    }
  }

  return area
}

function isChainAvailable(chain: readonly RoomCoordinate[], basePlan: BasePlan, rcl: number): boolean {
  const root = chain[0]
  if (!root) return false

  for (const structure of basePlan.structures) {
    if (structure.rcl > rcl) continue
    if (structure.coordinate.x !== root.x || structure.coordinate.y !== root.y) continue

    if (
      structure.structureType !== STRUCTURE_ROAD &&
      structure.structureType !== STRUCTURE_RAMPART &&
      structure.structureType !== STRUCTURE_CONTAINER
    ) {
      return false
    }
  }

  return true
}
