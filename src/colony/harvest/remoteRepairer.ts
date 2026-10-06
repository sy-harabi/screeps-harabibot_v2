import { tryCreateConstructionSite } from "../../capabilities/construction/constructionSite"
import { moveCreep } from "../../capabilities/movement/movement"
import { BUILDER_ROLE } from "../build/builder"
import type { HarvestSourceState } from "./harvestState"
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
  const state = (repairer.memory.remoteRepairerState ??= "working")

  if (state === "fetching" || state === "loading") {
    if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      repairer.memory.remoteRepairerState = "working"
    } else {
      runFetchSourceEnergy(repairer, source)
      return
    }
  }

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

  skipEdgeTargets(path, maintenance)

  const roadTarget = path[maintenance.pathIndex]

  if (roadTarget === undefined) {
    return
  }

  runRoadMaintenance(repairer, source, maintenance, roadTarget)
}

function runContainerMaintenance(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  target: RoomPosition,
): void {
  const targetRoom = Game.rooms[target.roomName]

  if (targetRoom === undefined) {
    moveCreep(repairer, {
      pos: target,
      range: 1,
    })
    return
  }

  const container = targetRoom
    .lookForAt(LOOK_STRUCTURES, target.x, target.y)
    .find((structure) => structure.structureType === STRUCTURE_CONTAINER)

  if (container !== undefined) {
    advanceMaintenance(repairer, source.path, maintenance)
    return
  }

  const site = targetRoom
    .lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
    .find((constructionSite) => constructionSite.structureType === STRUCTURE_CONTAINER)

  if (site === undefined) {
    tryCreateConstructionSite(targetRoom, target.x, target.y, STRUCTURE_CONTAINER)
    moveCreep(repairer, {
      pos: target,
      range: 1,
    })
    return
  }

  if (!ensureRepairerEnergy(repairer, source)) {
    return
  }

  const range = getRangeToTarget(repairer, target)

  if (range <= 3) {
    const finishesSite = site.progressTotal - site.progress <= getBuildPower(repairer)

    if (repairer.build(site) === OK && finishesSite) {
      advanceMaintenance(repairer, source.path, maintenance)
      return
    }
  }

  if (range > 1) {
    moveCreep(repairer, {
      pos: target,
      range: 1,
    })
  }
}

function runRoadMaintenance(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  target: RoomPosition,
): void {
  const targetRoom = Game.rooms[target.roomName]

  if (targetRoom === undefined) {
    moveCreep(repairer, {
      pos: target,
      range: 0,
    })
    return
  }

  const road = targetRoom
    .lookForAt(LOOK_STRUCTURES, target.x, target.y)
    .find((structure): structure is StructureRoad => structure.structureType === STRUCTURE_ROAD)

  if (road !== undefined) {
    runRoadRepair(repairer, source, maintenance, target, road)
    return
  }

  const site = targetRoom
    .lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
    .find((constructionSite) => constructionSite.structureType === STRUCTURE_ROAD)

  if (site !== undefined) {
    runRoadBuild(repairer, source, maintenance, target, site)
    return
  }

  tryCreateConstructionSite(targetRoom, target.x, target.y, STRUCTURE_ROAD)
  moveCreep(repairer, {
    pos: target,
    range: 0,
  })
}

function runRoadRepair(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  target: RoomPosition,
  road: StructureRoad,
): void {
  const targetHits = road.hitsMax * ROAD_FINISH_RATIO

  if (road.hits >= targetHits) {
    advanceMaintenance(repairer, source.path, maintenance)
    return
  }

  if (!ensureRepairerEnergy(repairer, source)) {
    return
  }

  const range = getRangeToTarget(repairer, target)

  if (range <= 3) {
    const finishesRoad = targetHits - road.hits <= getRepairPower(repairer)

    if (repairer.repair(road) === OK && finishesRoad) {
      advanceMaintenance(repairer, source.path, maintenance)
      return
    }
  }

  if (range > 0) {
    moveCreep(repairer, {
      pos: target,
      range: 0,
    })
  }
}

function runRoadBuild(
  repairer: Creep,
  source: HarvestSourceState,
  maintenance: RemoteMaintenanceMemory,
  target: RoomPosition,
  site: ConstructionSite,
): void {
  if (!ensureRepairerEnergy(repairer, source)) {
    return
  }

  const range = getRangeToTarget(repairer, target)

  if (range <= 3) {
    const finishesSite = site.progressTotal - site.progress <= getBuildPower(repairer)

    if (repairer.build(site) === OK && finishesSite) {
      advanceMaintenance(repairer, source.path, maintenance)
      return
    }
  }

  if (range > 0) {
    moveCreep(repairer, {
      pos: target,
      range: 0,
    })
  }
}

function advanceMaintenance(
  repairer: Creep,
  path: readonly RoomPosition[],
  maintenance: RemoteMaintenanceMemory,
): void {
  maintenance.pathIndex--
  skipEdgeTargets(path, maintenance)

  const nextTarget = path[maintenance.pathIndex]

  if (nextTarget === undefined) {
    return
  }

  moveCreep(repairer, {
    pos: nextTarget,
    range: 0,
  })
}

function skipEdgeTargets(path: readonly RoomPosition[], maintenance: RemoteMaintenanceMemory): void {
  while (maintenance.pathIndex >= 0) {
    const target = path[maintenance.pathIndex]

    if (target !== undefined && !isRoomEdge(target)) {
      return
    }

    maintenance.pathIndex--
  }
}

function ensureRepairerEnergy(repairer: Creep, source: HarvestSourceState): boolean {
  if (repairer.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return true
  }

  repairer.memory.remoteRepairerState = "fetching"
  runFetchSourceEnergy(repairer, source)

  return false
}

function runFetchSourceEnergy(repairer: Creep, source: HarvestSourceState): void {
  const sourcePos = source.path[source.path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (repairer.memory.remoteRepairerState === "fetching") {
    if (repairer.room.name !== sourcePos.roomName || !repairer.pos.inRangeTo(sourcePos, 1)) {
      moveCreep(repairer, {
        pos: sourcePos,
        range: 1,
      })
      return
    }

    repairer.memory.remoteRepairerState = "loading"
  }

  if (repairer.memory.remoteRepairerState !== "loading") {
    return
  }

  if (Game.rooms[sourcePos.roomName] === undefined) {
    moveCreep(repairer, {
      pos: new RoomPosition(25, 25, sourcePos.roomName),
      range: 20,
    })
    return
  }

  const dropped = source.largestDroppedEnergy

  if (dropped !== undefined) {
    if (!repairer.pos.isNearTo(dropped)) {
      moveCreep(repairer, {
        pos: dropped.pos,
        range: 1,
      })
      return
    }

    repairer.pickup(dropped)
    return
  }

  const container = source.container

  if (container !== undefined && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    if (!repairer.pos.isNearTo(container)) {
      moveCreep(repairer, {
        pos: container.pos,
        range: 1,
      })
      return
    }

    repairer.withdraw(container, RESOURCE_ENERGY)
    return
  }

  if (!repairer.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(repairer, {
      pos: sourcePos,
      range: 1,
    })
  }
}

function getRangeToTarget(repairer: Creep, target: RoomPosition): number {
  if (repairer.room.name !== target.roomName) {
    return Infinity
  }

  return repairer.pos.getRangeTo(target)
}

function getRepairPower(repairer: Creep): number {
  const workPower = repairer.getActiveBodyparts(WORK) * REPAIR_POWER
  const energyPower = repairer.store.getUsedCapacity(RESOURCE_ENERGY) / REPAIR_COST

  return Math.min(workPower, energyPower)
}

function getBuildPower(repairer: Creep): number {
  const workPower = repairer.getActiveBodyparts(WORK) * BUILD_POWER
  const energy = repairer.store.getUsedCapacity(RESOURCE_ENERGY)

  return Math.min(workPower, energy)
}

function isRoomEdge(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
}
