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
  readonly chains: readonly (readonly RoomCoordinate[])[]
}

const UPGRADE_ENERGY_PRIORITY = 20

const upgradeRuntimes = runtimeRegistry.createCache<string, UpgradeRuntime>("upgrade")

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
  const layout = getUpgradeLayout(colonyName, basePlan, controller.level)

  if (layout.area.length === 0) {
    return
  }

  const spawnedUpgraders = upgraders.filter((creep) => !creep.spawning)
  const fillArea = layout.area.slice(0, Math.min(spawnedUpgraders.length, layout.area.length))

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

  if (energyDepot !== undefined && !(energyDepot instanceof Resource) && energyDepot.structureType === STRUCTURE_CONTAINER) {
    requestEnergy(logistics, energyDepot, UPGRADE_ENERGY_PRIORITY)
  }

  runUpgraders(room, spawnedUpgraders, layout, energyDepot)
}

function runUpgraders(
  room: Room,
  upgraders: readonly Creep[],
  layout: UpgradeLayout,
  energyDepot?: StructureStorage | StructureContainer | Resource,
): void {
  const controller = room.controller

  if (!controller) {
    return
  }

  const upgraderByPosition = new Map<number, Creep>()

  for (const creep of upgraders) {
    if (creep.pos.roomName !== room.name) {
      continue
    }

    upgraderByPosition.set(toRoomIndex(creep.pos.x, creep.pos.y), creep)
  }

  for (const creep of upgraders) {
    if (creep.pos.roomName !== room.name || creep.pos.getRangeTo(controller) > 3) {
      continue
    }

    creep.upgradeController(controller)
    setWorkingArea(creep, controller.pos, 3)

    const position = findUpgradePosition(creep, layout.chains)

    if (position === undefined) {
      continue
    }

    if (position.depth === 0 && energyDepot !== undefined && creep.pos.isNearTo(energyDepot)) {
      if (energyDepot instanceof Resource) {
        creep.pickup(energyDepot)
      } else if (energyDepot.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.withdraw(energyDepot, RESOURCE_ENERGY)
      }
    }

    const successorPos = position.chain[position.depth + 1]

    if (successorPos === undefined) {
      continue
    }

    const successor = upgraderByPosition.get(toRoomIndex(successorPos.x, successorPos.y))

    if (
      successor === undefined ||
      !creep.pos.isNearTo(successor) ||
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0 ||
      successor.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
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

function findUpgradePosition(
  creep: Creep,
  chains: readonly (readonly RoomCoordinate[])[],
): { chain: readonly RoomCoordinate[]; depth: number } | undefined {
  for (const chain of chains) {
    for (let depth = 0; depth < chain.length; depth++) {
      const pos = chain[depth]

      if (creep.pos.x === pos.x && creep.pos.y === pos.y) {
        return { chain, depth }
      }
    }
  }

  return
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
  const maxLength = Math.max(...chains.map((chain) => chain.length), 0)

  for (let depth = 0; depth < maxLength; depth++) {
    for (const chain of chains) {
      const pos = chain[depth]

      if (pos !== undefined) {
        area.push(pos)
      }
    }
  }

  return { area, chains }
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
