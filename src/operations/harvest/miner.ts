import { moveCreep } from "../../capabilities/movement/movement"
import { getOperationCreeps, type TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord, SourceState } from "./harvestOperation"

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
  const source = Game.getObjectById(sourceState.data.sourceId)

  const miningPos = sourceState.data.path[sourceState.data.path.length - 1]

  if (!source) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  const result = miner.harvest(source)

  if (result === ERR_NOT_IN_RANGE) {
    moveCreep(miner, { pos: miningPos, range: 0 })
    return "moving"
  }

  return "harvesting"
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
