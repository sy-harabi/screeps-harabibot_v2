import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { getStructuresByType } from "../../world/roomStructures"
import { ENERGY_REQUEST_PRIORITY, requestEnergy, type LogisticsState } from "../logistics/logistics"

const TOWER_REFILL_THRESHOLD = 400

const TOWER_REPAIR_MIN_ENERGY = 500

const ROAD_REPAIR_TRIGGER = 0.3

interface TowerRuntime {
  repairTargetId?: Id<StructureRoad>
  nextRepairCheck?: number
}

const towerRuntimes = runtimeRegistry.createCache<string, TowerRuntime>("tower.colonies", {
  cleanupInterval: 500,
  cleanup: (runtimes) => {
    for (const colonyName of runtimes.keys()) {
      if (Game.rooms[colonyName]?.controller?.my !== true) {
        runtimes.delete(colonyName)
      }
    }
  },
})

function getTowerRuntime(colonyName: string): TowerRuntime {
  let runtime = towerRuntimes.get(colonyName)

  if (runtime === undefined) {
    runtime = {}
    towerRuntimes.set(colonyName, runtime)
  }

  return runtime
}

export function runTowers(room: Room, logistics: LogisticsState): void {
  const towers = getStructuresByType(room, STRUCTURE_TOWER)

  registerTowerEnergyRequests(towers, logistics)
  repairRoads(room, towers)
}

function repairRoads(room: Room, towers: StructureTower[]): void {
  if (towers.length === 0) {
    return
  }

  const runtime = getTowerRuntime(room.name)
  const target = getRoadRepairTarget(room, runtime)

  if (target === undefined) {
    return
  }

  const tower = target.pos.findClosestByRange(towers)

  if (tower === null) {
    return
  }

  if (tower.store.getUsedCapacity(RESOURCE_ENERGY) <= TOWER_REPAIR_MIN_ENERGY) {
    return
  }

  tower.repair(target)
}

function registerTowerEnergyRequests(towers: readonly StructureTower[], logistics: LogisticsState): void {
  for (const tower of towers) {
    if (tower.store.getFreeCapacity(RESOURCE_ENERGY) <= TOWER_REFILL_THRESHOLD) {
      continue
    }

    requestEnergy(logistics, tower, ENERGY_REQUEST_PRIORITY.tower)
  }
}

function getRoadRepairTarget(room: Room, runtime: TowerRuntime): StructureRoad | undefined {
  if (runtime.repairTargetId !== undefined) {
    const target = Game.getObjectById(runtime.repairTargetId)

    if (target !== null && target.hits < target.hitsMax) {
      return target
    }

    runtime.repairTargetId = undefined
  }

  if (runtime.nextRepairCheck !== undefined && Game.time < runtime.nextRepairCheck) {
    return
  }

  const target = getStructuresByType(room, STRUCTURE_ROAD).find(
    (road) => road.hits < road.hitsMax * ROAD_REPAIR_TRIGGER,
  )

  if (target !== undefined) {
    runtime.repairTargetId = target.id
    return target
  }

  runtime.nextRepairCheck = Game.time + 100
  return
}
