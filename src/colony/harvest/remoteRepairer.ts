import { tryCreateConstructionSite } from "../../capabilities/construction/constructionSite"
import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import { BUILDER_ROLE } from "../build/builder"
import type { HarvestSourceState } from "./harvest"
import type { RemoteMaintenanceMemory } from "./harvestMemory"
import { getHarvestMemory } from "./harvestMemory"
import { createRemoteBuilderBody, REMOTE_BUILDER_TARGET_WORK } from "./remoteBuilder"
import { advanceRemoteMaintenanceSource } from "./remoteMaintenance"

export const REMOTE_REPAIRER_ROLE = "remoteRepairer"

const ROAD_FINISH_RATIO = 0.9

export function createRemoteRepairerBody(room: Room): readonly BodyPartConstant[] | undefined {
  return createRemoteBuilderBody(room, REMOTE_BUILDER_TARGET_WORK)
}

export function runRemoteRepairers(
  room: Room,
  repairers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
): void {
  const maintenance = getHarvestMemory(room).maintenance

  if (maintenance === undefined) {
    for (const repairer of repairers) {
      repairer.memory.role = BUILDER_ROLE
    }
    return
  }

  const repairer = repairers[0]

  for (let i = 1; i < repairers.length; i++) {
    repairers[i].memory.role = BUILDER_ROLE
  }

  if (repairer === undefined || repairer.spawning) {
    return
  }

  const source = sourceById.get(maintenance.sourceId)

  if (source === undefined) {
    delete getHarvestMemory(room).maintenance
    repairer.memory.role = BUILDER_ROLE
    return
  }

  source.remoteRepairerCarryCapacity = repairer.store.getCapacity(RESOURCE_ENERGY)

  runRemoteRepairer(repairer, source, maintenance)

  if (maintenance.pathIndex >= 0) {
    return
  }

  if (!advanceRemoteMaintenanceSource(room, sourceStates)) {
    repairer.memory.role = BUILDER_ROLE
  }
}

function runRemoteRepairer(repairer: Creep, source: HarvestSourceState, maintenance: RemoteMaintenanceMemory): void {
  const path = source.path
  const targetIndex = maintenance.pathIndex
  const target = path[targetIndex]

  if (target === undefined) {
    maintenance.pathIndex--
    return
  }

  if (targetIndex === path.length - 1) {
    runContainerMaintenance(repairer, source, maintenance, target)
    return
  }

  if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    runFetchSourceEnergy(repairer, source)
    return
  }

  if (isRoomEdge(target)) {
    maintenance.pathIndex--
    moveCreepByPath(repairer, path, { reverse: true })
    return
  }

  const targetRoom = Game.rooms[target.roomName]

  if (targetRoom === undefined) {
    moveCreepByPath(repairer, path, { reverse: true })
    return
  }

  const road = targetRoom
    .lookForAt(LOOK_STRUCTURES, target.x, target.y)
    .find((structure) => structure.structureType === STRUCTURE_ROAD)

  if (road !== undefined) {
    runRoadRepair(repairer, source, maintenance, road)
    return
  }

  const site = targetRoom
    .lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
    .find((constructionSite) => constructionSite.structureType === STRUCTURE_ROAD)

  if (site !== undefined) {
    if (repairer.pos.getRangeTo(site) > 3) {
      moveCreepByPath(repairer, path, { reverse: true })
      return
    }

    repairer.build(site)
    return
  }

  tryCreateConstructionSite(targetRoom, target.x, target.y, STRUCTURE_ROAD)
}

function runContainerMaintenance(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  target: RoomPosition,
): void {
  if (!repairer.pos.inRangeTo(target, 1)) {
    moveCreepByPath(repairer, source.path)
    return
  }

  if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    runFetchSourceEnergy(repairer, source)
    return
  }

  const targetRoom = Game.rooms[target.roomName]

  if (targetRoom === undefined) {
    return
  }

  const container = targetRoom
    .lookForAt(LOOK_STRUCTURES, target.x, target.y)
    .find((structure) => structure.structureType === STRUCTURE_CONTAINER)

  if (container !== undefined) {
    if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      return
    }

    maintenance.pathIndex--
    moveCreepByPath(repairer, source.path, { reverse: true })
    return
  }

  const site = targetRoom
    .lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
    .find((constructionSite) => constructionSite.structureType === STRUCTURE_CONTAINER)

  if (site !== undefined) {
    if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      repairer.build(site)
    }
    return
  }

  tryCreateConstructionSite(targetRoom, target.x, target.y, STRUCTURE_CONTAINER)
}

function runRoadRepair(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  road: Structure,
): void {
  const targetHits = road.hitsMax * ROAD_FINISH_RATIO

  if (road.hits >= targetHits) {
    maintenance.pathIndex--
    moveCreepByPath(repairer, source.path, { reverse: true })
    return
  }

  const range = repairer.pos.getRangeTo(road)

  if (range > 3) {
    moveCreepByPath(repairer, source.path, { reverse: true })
    return
  }

  const repairPower = getRepairPower(repairer)
  const finishesRoad = targetHits - road.hits <= repairPower

  if (repairer.repair(road) !== OK) {
    return
  }

  if (finishesRoad) {
    maintenance.pathIndex--
    moveCreepByPath(repairer, source.path, { reverse: true })
    return
  }

  if (range > 1) {
    moveCreepByPath(repairer, source.path, { reverse: true })
  }
}

function getRepairPower(repairer: Creep): number {
  const workPower = repairer.getActiveBodyparts(WORK) * REPAIR_POWER
  const energyPower = repairer.store.getUsedCapacity(RESOURCE_ENERGY) / REPAIR_COST

  return Math.min(workPower, energyPower)
}

function runFetchSourceEnergy(repairer: Creep, source: HarvestSourceState): void {
  const sourcePos = source.path[source.path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (!repairer.pos.inRangeTo(sourcePos, 1)) {
    moveCreepByPath(repairer, source.path)
    return
  }

  tryFetchNearbySourceEnergy(repairer, source)
}

function tryFetchNearbySourceEnergy(repairer: Creep, source: HarvestSourceState): boolean {
  const dropped = source.largestDroppedEnergy

  if (dropped !== undefined) {
    if (!repairer.pos.isNearTo(dropped)) {
      moveCreep(repairer, {
        pos: dropped.pos,
        range: 1,
      })
      return true
    }

    repairer.pickup(dropped)
    return true
  }

  const container = source.container

  if (container === undefined || container.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) {
    return false
  }

  if (!repairer.pos.isNearTo(container)) {
    moveCreep(repairer, {
      pos: container.pos,
      range: 1,
    })
    return true
  }

  repairer.withdraw(container, RESOURCE_ENERGY)
  return true
}

function isRoomEdge(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
}
