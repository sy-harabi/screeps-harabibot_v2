import { moveCreep } from "../../capabilities/movement/movement"
import { getOperationCreeps, type TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord, SourceState } from "./harvestOperation"
import { getCreepHeap } from "../../runtime/creepRuntime"

interface MinerRuntime {
  miningPosition?: RoomPosition
  mining?: boolean
}

export const MINER_ROLE = "miner"

type RunMinerResult = "harvesting" | "moving"

export function runMiners(
  operation: HarvestOperationRecord,
  context: TickContext,
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
  for (const miner of getOperationCreeps(context, operation.id, MINER_ROLE)) {
    const sourceId = miner.memory.sourceId

    if (!sourceId) {
      continue
    }

    const sourceState = sourceStateById.get(sourceId)

    if (sourceState === undefined) {
      continue
    }

    if (runMiner(miner, sourceState) === "harvesting") {
      sourceState.harvestingPower += miner.getActiveBodyparts(WORK) * HARVEST_POWER
    }
  }
}

function runMiner(miner: Creep, sourceState: SourceState): RunMinerResult {
  let miningPos = getMiningPosition(miner, sourceState)

  if (!miningPos) {
    miner.say("he")
    return "moving"
  }

  const source = Game.getObjectById(sourceState.data.sourceId)

  if (!source) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  const runtime = getCreepHeap<MinerRuntime>(miner.name)

  if (miner.pos.isEqualTo(miningPos)) {
    runtime.mining = true
    miner.harvest(source)
    return "harvesting"
  }

  if (runtime.mining) {
    miningPos = getMiningPosition(miner, sourceState, false)

    if (miningPos === undefined) {
      return "moving"
    }
  }

  moveCreep(miner, { pos: miningPos, range: 0 })

  return "moving"
}

function getMiningPosition(miner: Creep, sourceState: SourceState, useCache: boolean = true): RoomPosition | undefined {
  const runtime = getCreepHeap<MinerRuntime>(miner.name)

  if (useCache && runtime.miningPosition) {
    return runtime.miningPosition
  }

  const primaryPos = sourceState.data.miningPositions[0]

  if (!miner.pos.isNearTo(primaryPos)) {
    return primaryPos
  }

  const occupant = primaryPos.lookFor(LOOK_CREEPS).find((creep) => creep.name !== miner.name)

  if (!occupant) {
    return primaryPos
  }

  const myWork = miner.getActiveBodyparts(WORK)

  if (occupant.my && occupant.memory.role === MINER_ROLE && occupant.getActiveBodyparts(WORK) < myWork) {
    // I am stronger. Let traffic push the weaker miner away.
    return primaryPos
  }

  const fallback = findFallbackMiningPosition(miner, sourceState)

  if (fallback) {
    runtime.miningPosition = fallback
  }

  return fallback
}

function findFallbackMiningPosition(miner: Creep, sourceState: SourceState): RoomPosition | undefined {
  const myWork = miner.getActiveBodyparts(WORK)

  for (let i = 1; i < sourceState.data.miningPositions.length; i++) {
    const pos = sourceState.data.miningPositions[i]

    if (
      pos.lookFor(LOOK_CREEPS).some((occupant) => {
        if (
          occupant.name !== miner.name &&
          occupant.my &&
          occupant.memory.role === MINER_ROLE &&
          occupant.getActiveBodyparts(WORK) >= myWork
        ) {
          return true
        }

        return false
      })
    ) {
      continue
    }

    return pos
  }

  return
}

export function createMinerBody(roomName: string): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 250) {
    return undefined
  }

  const workCount = Math.min(5, Math.floor((budget - BODYPART_COST[MOVE]) / BODYPART_COST[WORK]))

  return [...Array<BodyPartConstant>(workCount).fill(WORK), MOVE]
}
