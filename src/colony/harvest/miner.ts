import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getIntendedCoord } from "../../capabilities/movement/traffic"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { HarvestSourceState } from "./harvest"

interface MinerRuntime {
  miningPosition?: RoomPosition
}

const minerRuntimes = runtimeRegistry.createCache<string, MinerRuntime>("harvest.miners", {
  cleanupInterval: 100,
  cleanup: (runtimes) => {
    for (const creepName of runtimes.keys()) {
      if (Game.creeps[creepName] === undefined) {
        runtimes.delete(creepName)
      }
    }
  },
})

function getMinerRuntime(creepName: string): MinerRuntime {
  let runtime = minerRuntimes.get(creepName)

  if (runtime === undefined) {
    runtime = {}
    minerRuntimes.set(creepName, runtime)
  }

  return runtime
}

export const MINER_ROLE = "miner"

type RunMinerResult = "harvesting" | "moving"

export function runMiners(
  miners: readonly Creep[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  travelingMiners?: Creep[],
): void {
  for (const miner of miners) {
    const sourceId = miner.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined || source.requiredHarvestPower <= 0 || miner.spawning) {
      continue
    }

    const result = runMiner(miner, source)

    if (result === "harvesting") {
      source.harvestingPower += miner.getActiveBodyparts(WORK) * HARVEST_POWER
      continue
    }

    if (travelingMiners !== undefined && (miner.fatigue > 0 || getIntendedCoord(miner) !== undefined)) {
      travelingMiners.push(miner)
    }
  }
}

function runMiner(miner: Creep, sourceState: HarvestSourceState): RunMinerResult {
  const path = sourceState.path
  const pathEnd = path[path.length - 1]

  if (pathEnd !== undefined && (miner.pos.roomName !== pathEnd.roomName || !miner.pos.inRangeTo(pathEnd, 3))) {
    moveCreepByPath(miner, path)
    return "moving"
  }

  const miningPos = getMiningPosition(miner, sourceState)

  if (miningPos === undefined) {
    return "moving"
  }

  const source = Game.getObjectById(sourceState.id)

  if (source === null) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  if (!miner.pos.isEqualTo(miningPos)) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  const container = sourceState.container

  if (
    container !== undefined &&
    container.hits < container.hitsMax &&
    miner.store.getUsedCapacity(RESOURCE_ENERGY) >= miner.getActiveBodyparts(WORK) * REPAIR_COST &&
    canSpendTickOnRepair(source, miner)
  ) {
    miner.repair(container)
  } else {
    miner.harvest(source)
  }

  return "harvesting"
}

function canSpendTickOnRepair(source: Source, miner: Creep): boolean {
  const harvestPower = miner.getActiveBodyparts(WORK) * HARVEST_POWER
  const ticksToRegeneration = source.ticksToRegeneration

  if (ticksToRegeneration === undefined) {
    return false
  }

  const harvestTicksNeeded = Math.ceil(source.energy / harvestPower)

  return harvestTicksNeeded < ticksToRegeneration
}

function getMiningPosition(miner: Creep, sourceState: HarvestSourceState): RoomPosition | undefined {
  const primaryPos = sourceState.miningPositions[0]

  if (primaryPos === undefined) {
    return
  }

  const runtime = getMinerRuntime(miner.name)

  if (runtime.miningPosition !== undefined) {
    const primaryOccupied = primaryPos.lookFor(LOOK_CREEPS).some((creep) => creep.name !== miner.name)

    if (primaryOccupied) {
      return runtime.miningPosition
    }

    delete runtime.miningPosition
    return primaryPos
  }

  if (miner.pos.isEqualTo(primaryPos) || !miner.pos.isNearTo(primaryPos)) {
    return primaryPos
  }

  const primaryOccupied = primaryPos.lookFor(LOOK_CREEPS).some((creep) => creep.name !== miner.name)

  if (!primaryOccupied) {
    return primaryPos
  }

  const fallback = findFallbackMiningPosition(miner, sourceState)

  if (fallback !== undefined) {
    runtime.miningPosition = fallback
  }

  return fallback
}

function findFallbackMiningPosition(miner: Creep, sourceState: HarvestSourceState): RoomPosition | undefined {
  for (let i = 1; i < sourceState.miningPositions.length; i++) {
    const pos = sourceState.miningPositions[i]
    const occupied = pos.lookFor(LOOK_CREEPS).some((creep) => creep.name !== miner.name)

    if (!occupied) {
      return pos
    }
  }

  return
}

export function createMinerBody(
  room: Room,
  path: readonly RoomPosition[],
  targetWork: number,
  useEnergyCapacity: boolean,
  options: {
    carry?: boolean
  } = {},
): readonly BodyPartConstant[] | undefined {
  const budget = useEnergyCapacity
    ? room.energyCapacityAvailable
    : Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 250) {
    return undefined
  }

  const carryCount = options.carry ? 1 : 0
  const fixedCost = BODYPART_COST[MOVE] + carryCount * BODYPART_COST[CARRY]
  const workCount = Math.min(targetWork, Math.floor((budget - fixedCost) / BODYPART_COST[WORK]))

  const maxMoveByEnergy = Math.floor(
    (budget - workCount * BODYPART_COST[WORK] - carryCount * BODYPART_COST[CARRY]) / BODYPART_COST[MOVE],
  )
  const maxMoveBySize = MAX_CREEP_SIZE - workCount - carryCount
  const maxMoveCount = Math.min(workCount * 5, maxMoveByEnergy, maxMoveBySize)

  let bestMoveCount = 1
  let bestSpawnUsage = Infinity

  for (let moveCount = 1; moveCount <= maxMoveCount; moveCount++) {
    const travelTicks = estimatePathTravelTicks(path, moveCount, workCount)

    if (travelTicks >= CREEP_LIFE_TIME) {
      continue
    }

    const bodySize = workCount + moveCount + carryCount
    const spawnTime = bodySize * CREEP_SPAWN_TIME
    const productiveLifetime = CREEP_LIFE_TIME - travelTicks

    const spawnUsage = spawnTime / productiveLifetime

    if (spawnUsage < bestSpawnUsage) {
      bestSpawnUsage = spawnUsage
      bestMoveCount = moveCount
    }
  }

  return [
    ...Array<BodyPartConstant>(workCount).fill(WORK),
    ...Array<BodyPartConstant>(carryCount).fill(CARRY),
    ...Array<BodyPartConstant>(bestMoveCount).fill(MOVE),
  ]
}
