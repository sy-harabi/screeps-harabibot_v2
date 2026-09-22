import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { SourceState } from "./harvest"

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

export function runMiners(miners: readonly Creep[], sourceStateById: Map<Id<Source>, SourceState>): void {
  for (const miner of miners) {
    const sourceId = miner.memory.sourceId

    if (!sourceId) {
      continue
    }

    const sourceState = sourceStateById.get(sourceId)

    if (sourceState === undefined) {
      continue
    }

    if (miner.spawning) {
      continue
    }

    if (runMiner(miner, sourceState) === "harvesting") {
      sourceState.harvestingPower += miner.getActiveBodyparts(WORK) * HARVEST_POWER
    }
  }
}

function runMiner(miner: Creep, sourceState: SourceState): RunMinerResult {
  const path = sourceState.data.path
  const pathEnd = path[path.length - 1]

  if (pathEnd !== undefined && (miner.pos.roomName !== pathEnd.roomName || !miner.pos.inRangeTo(pathEnd, 3))) {
    moveCreepByPath(miner, path)
    return "moving"
  }

  const miningPos = getMiningPosition(miner, sourceState)

  if (!miningPos) {
    return "moving"
  }

  const source = Game.getObjectById(sourceState.data.sourceId)

  if (!source) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  const result = miner.harvest(source)

  if (!miner.pos.isEqualTo(miningPos)) {
    moveCreep(miner, { pos: miningPos, range: 0 })
  }

  return result === ERR_NOT_IN_RANGE ? "moving" : "harvesting"
}

function getMiningPosition(miner: Creep, sourceState: SourceState): RoomPosition | undefined {
  const runtime = getMinerRuntime(miner.name)
  const primaryPos = sourceState.data.miningPositions[0]

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

function findFallbackMiningPosition(miner: Creep, sourceState: SourceState): RoomPosition | undefined {
  for (let i = 1; i < sourceState.data.miningPositions.length; i++) {
    const pos = sourceState.data.miningPositions[i]
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
): readonly BodyPartConstant[] | undefined {
  const budget = useEnergyCapacity
    ? room.energyCapacityAvailable
    : Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 250) {
    return undefined
  }

  const workCount = Math.min(targetWork, Math.floor((budget - BODYPART_COST[MOVE]) / BODYPART_COST[WORK]))

  const maxMoveByEnergy = Math.floor((budget - workCount * BODYPART_COST[WORK]) / BODYPART_COST[MOVE])

  const maxMoveBySize = MAX_CREEP_SIZE - workCount

  const maxMoveCount = Math.min(workCount * 5, maxMoveByEnergy, maxMoveBySize)

  let bestMoveCount = 1
  let bestSpawnUsage = Infinity

  for (let moveCount = 1; moveCount <= maxMoveCount; moveCount++) {
    const travelTicks = estimatePathTravelTicks(path, moveCount, workCount)

    if (travelTicks >= CREEP_LIFE_TIME) {
      continue
    }

    const bodySize = workCount + moveCount
    const spawnTime = bodySize * CREEP_SPAWN_TIME
    const productiveLifetime = CREEP_LIFE_TIME - travelTicks

    const spawnUsage = spawnTime / productiveLifetime

    if (spawnUsage < bestSpawnUsage) {
      bestSpawnUsage = spawnUsage
      bestMoveCount = moveCount
    }
  }
  return [...Array<BodyPartConstant>(workCount).fill(WORK), ...Array<BodyPartConstant>(bestMoveCount).fill(MOVE)]
}
