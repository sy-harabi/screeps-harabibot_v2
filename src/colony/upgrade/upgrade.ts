import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { fillAreaWithCreeps } from "../../capabilities/movement/fillAreaWithCreeps"
import { setWorkingArea } from "../../capabilities/movement/traffic"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, TickContext } from "../../kernel/tickContext"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import { toRoomIndex } from "../../world/map/roomGrid"
import { getStructuresByType } from "../../world/roomStructures"
import { LogisticsState, requestEnergy } from "../logistics/logistics"
import { createUpgraderBody, UPGRADER_ROLE } from "./upgrader"

interface UpgradeRuntime {
  rcl?: number
  layout?: UpgradeLayout
}

interface UpgradeLayout {
  readonly area: readonly RoomCoordinate[]
  readonly rootPositions: ReadonlySet<number>
  readonly nextByPosition: ReadonlyMap<number, number>
}

const UPGRADE_ENERGY_PRIORITY = 20

const upgradeRuntimes = runtimeRegistry.createCache<string, UpgradeRuntime>("upgrade")

export function runUpgrade(
  colonyName: string,
  room: Room,
  basePlan: BasePlan,
  context: TickContext,
  logistics: LogisticsState,
  income: number,
): void {
  const controller = room.controller

  if (!controller) {
    return
  }

  const upgraders = getColonyCreeps(context, colonyName, UPGRADER_ROLE)
  const layout = getUpgradeLayout(colonyName, basePlan, controller.level)

  if (layout.area.length === 0) {
    return
  }

  const spawnedUpgraders: Creep[] = []

  let effectiveWork = 0
  let effectiveUpgraders = 0

  const upgraderByPosition = new Map<number, Creep>()

  for (const upgrader of upgraders) {
    if (!upgrader.spawning) {
      spawnedUpgraders.push(upgrader)

      if (upgrader.pos.roomName === colonyName) {
        upgraderByPosition.set(toRoomIndex(upgrader.pos.x, upgrader.pos.y), upgrader)
      }
    }

    const replacementLeadTime = upgrader.body.length * CREEP_SPAWN_TIME + 20

    if ((upgrader.ticksToLive ?? CREEP_LIFE_TIME) <= replacementLeadTime) {
      continue
    }

    effectiveWork += upgrader.getActiveBodyparts(WORK)
    effectiveUpgraders++
  }

  const fillArea = layout.area.slice(0, Math.min(spawnedUpgraders.length, layout.area.length))

  fillAreaWithCreeps(colonyName, fillArea, spawnedUpgraders)

  const targetWork = getTargetUpgradeWork(room, income)

  if (effectiveWork < targetWork && effectiveUpgraders < layout.area.length) {
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

  const energyDepot = getUpgradeEnergyDepot(room, basePlan)

  registerUpgradeEnergyRequests(logistics, energyDepot, layout, upgraderByPosition)
  runUpgraders(room, spawnedUpgraders, layout, energyDepot, upgraderByPosition)
}

function registerUpgradeEnergyRequests(
  logistics: LogisticsState,
  energyDepot: StructureStorage | StructureContainer | Resource | undefined,
  layout: UpgradeLayout,
  upgraderByPosition: ReadonlyMap<number, Creep>,
): void {
  if (energyDepot instanceof Resource) {
    return
  }

  if (energyDepot instanceof Structure) {
    if (energyDepot.structureType === STRUCTURE_CONTAINER) {
      requestEnergy(logistics, energyDepot, UPGRADE_ENERGY_PRIORITY)
    }
    return
  }

  for (const rootPosition of layout.rootPositions) {
    const rootUpgrader = upgraderByPosition.get(rootPosition)

    if (rootUpgrader !== undefined) {
      requestEnergy(logistics, rootUpgrader, UPGRADE_ENERGY_PRIORITY)
    }
  }
}

function runUpgraders(
  room: Room,
  upgraders: readonly Creep[],
  layout: UpgradeLayout,
  energyDepot: StructureStorage | StructureContainer | Resource | undefined,
  upgraderByPosition: ReadonlyMap<number, Creep>,
): void {
  const controller = room.controller

  if (!controller) {
    return
  }

  for (const creep of upgraders) {
    if (creep.pos.getRangeTo(controller) > 3) {
      continue
    }

    creep.upgradeController(controller)
    setWorkingArea(creep, controller.pos, 3)

    const index = toRoomIndex(creep.pos.x, creep.pos.y)

    if (layout.rootPositions.has(index) && energyDepot !== undefined && creep.pos.isNearTo(energyDepot)) {
      if (energyDepot instanceof Resource) {
        creep.pickup(energyDepot)
      } else if (energyDepot.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.withdraw(energyDepot, RESOURCE_ENERGY)
      }
    }

    const successorPosition = layout.nextByPosition.get(index)

    if (successorPosition === undefined) {
      continue
    }

    const successor = upgraderByPosition.get(successorPosition)

    if (!successor) {
      continue
    }

    creep.transfer(successor, RESOURCE_ENERGY)
  }
}

function getUpgradeEnergyDepot(
  room: Room,
  basePlan: BasePlan,
): StructureStorage | StructureContainer | Resource | undefined {
  if (room.storage) {
    return room.storage
  }

  for (const container of getStructuresByType(room, STRUCTURE_CONTAINER)) {
    if (container.pos.x === basePlan.storage.x && container.pos.y === basePlan.storage.y) {
      return container
    }
  }

  return room
    .lookForAt(LOOK_RESOURCES, basePlan.storage.x, basePlan.storage.y)
    .find((resource) => resource.resourceType === RESOURCE_ENERGY)
}

function getTargetUpgradeWork(room: Room, income: number): number {
  const level = room.controller?.level

  if (level === undefined) {
    return 0
  }

  const limit = level === 8 ? CONTROLLER_MAX_UPGRADE_PER_TICK : Infinity

  return Math.min(Math.floor(income), limit)
}

function getUpgradeLayout(roomName: string, basePlan: BasePlan, rcl: number): UpgradeLayout {
  const runtime = getUpgradeRuntime(roomName)

  if (runtime.rcl === rcl && runtime.layout !== undefined) {
    return runtime.layout
  }

  const layout = createUpgradeLayout(basePlan, rcl)

  runtime.rcl = rcl
  runtime.layout = layout

  return layout
}

export function getUpgradeRuntime(colonyName: string): UpgradeRuntime {
  let runtime = upgradeRuntimes.get(colonyName)

  if (runtime === undefined) {
    runtime = {}
    upgradeRuntimes.set(colonyName, runtime)
  }

  return runtime
}

function createUpgradeLayout(basePlan: BasePlan, rcl: number): UpgradeLayout {
  const { left, middle, right } = basePlan.controller.upgradeChains
  const chains = [middle, left, right].filter((chain) => isChainAvailable(chain, basePlan, rcl))

  const area: RoomCoordinate[] = []
  const rootPositions = new Set<number>()
  const nextByPosition = new Map<number, number>()
  const maxLength = Math.max(...chains.map((chain) => chain.length), 0)

  for (const chain of chains) {
    const root = chain[0]

    if (root !== undefined) {
      rootPositions.add(toRoomIndex(root.x, root.y))
    }

    for (let i = 0; i < chain.length - 1; i++) {
      const current = chain[i]
      const next = chain[i + 1]

      nextByPosition.set(toRoomIndex(current.x, current.y), toRoomIndex(next.x, next.y))
    }
  }

  for (let depth = 0; depth < maxLength; depth++) {
    for (const chain of chains) {
      const pos = chain[depth]

      if (pos !== undefined) {
        area.push(pos)
      }
    }
  }

  return { area, rootPositions, nextByPosition }
}

function isChainAvailable(chain: readonly RoomCoordinate[], basePlan: BasePlan, rcl: number): boolean {
  const root = chain[0]

  if (!root) {
    return false
  }

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
