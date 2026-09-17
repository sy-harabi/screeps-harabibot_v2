import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getOperationCreeps, TickContext } from "../../kernel/tickContext"
import { OwnedSourceOperationRecord } from "./ownedSourceOperation"

export const MINER_ROLE = "miner"

export function planMiner(operation: OwnedSourceOperationRecord, context: TickContext): void {
  const miners = getOperationCreeps(context, operation.id, MINER_ROLE)
  if (miners.length > 0) {
    return
  }

  requestSpawn(
    {
      requesterId: operation.id,
      roomName: operation.roomName,
      priorityType: "ownedSource",
      operationOrder: 0,
      rolesByPriority: [MINER_ROLE],
    },
    () => createMinerBody(operation.roomName),
    MINER_ROLE,
  )
}

export function runMiners(operation: OwnedSourceOperationRecord, context: TickContext): void {
  const miners = getOperationCreeps(context, operation.id, MINER_ROLE)
  const source = Game.getObjectById(operation.sourceId)
  if (!source) {
    return
  }

  for (const miner of miners) {
    if (miner.harvest(source) === ERR_NOT_IN_RANGE) {
      miner.moveTo(source)
    }
  }
}

function createMinerBody(roomName: string): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = room.energyAvailable

  if (budget < 200) {
    return undefined
  }

  const workCount = Math.min(5, Math.floor((budget - 100) / BODYPART_COST[WORK]))

  return [...Array<BodyPartConstant>(workCount).fill(WORK), CARRY, MOVE]
}
