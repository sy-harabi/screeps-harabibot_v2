import { moveCreep } from "../../capabilities/movement/movement"
import { getCreepHeap } from "../../runtime/creepRuntime"
import type { SourceState } from "./harvest"

interface MinerRuntime {
  miningPosition?: RoomPosition
}

export const MINER_ROLE = "miner"

type RunMinerResult = "harvesting" | "moving"

export function runMiners(
  miners: readonly Creep[],
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
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
  const miningPos = getMiningPosition(miner, sourceState)

  if (miningPos === undefined) {
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
  const runtime = getCreepHeap<MinerRuntime>(miner.name)
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

export function createMinerBody(roomName: string, useEnergyCapacity: boolean): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = useEnergyCapacity
    ? room.energyCapacityAvailable
    : Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 250) {
    return undefined
  }

  const workCount = Math.min(5, Math.floor((budget - BODYPART_COST[MOVE]) / BODYPART_COST[WORK]))

  return [...Array<BodyPartConstant>(workCount).fill(WORK), MOVE]
}
