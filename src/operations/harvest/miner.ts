import { getOperationCreeps, type TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord } from "./harvestOperation"

export const MINER_ROLE = "miner"

export function runMiners(operation: HarvestOperationRecord, context: TickContext): void {
  for (const miner of getOperationCreeps(context, operation.id, MINER_ROLE)) {
    const sourceId = miner.memory.sourceId

    if (!sourceId) {
      continue
    }

    const source = Game.getObjectById(sourceId)

    if (!source) {
      continue
    }

    if (miner.harvest(source) === ERR_NOT_IN_RANGE) {
      miner.moveTo(source)
    }
  }
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
