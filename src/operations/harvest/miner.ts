import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getOperationCreeps, type TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord } from "./harvestOperation"

export const MINER_ROLE = "miner"

export function planMiners(operation: HarvestOperationRecord, context: TickContext): void {
  const room = context.ownedRooms.get(operation.roomName)

  if (!room) {
    return
  }

  const sources = room.find(FIND_SOURCES)

  const miners = getHarvestMiners(operation, context)

  for (let sourceOrder = 0; sourceOrder < sources.length; sourceOrder++) {
    const source = sources[sourceOrder]

    if (miners.some((miner) => miner.memory.sourceId === source.id)) {
      continue
    }

    requestSpawn(
      {
        requesterId: operation.id,
        roomName: operation.roomName,
        priorityType: "ownedSource",
        operationOrder: sourceOrder,
        rolesByPriority: [MINER_ROLE],
      },
      () => createMinerBody(operation.roomName),
      MINER_ROLE,
      {
        memory: { sourceId: source.id },
      },
    )
  }
}

export function runMiners(operation: HarvestOperationRecord, context: TickContext): void {
  for (const miner of getHarvestMiners(operation, context)) {
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

function getHarvestMiners(operation: HarvestOperationRecord, context: TickContext): Creep[] {
  const indexedMiners = getOperationCreeps(context, operation.id, MINER_ROLE)
  const result = [...indexedMiners]
  const indexedNames = new Set(indexedMiners.map((creep) => creep.name))

  // A legacy miner may be reassigned after TickContext was built. Include it
  // immediately so the migration does not cause a duplicate spawn or a lost tick.
  for (const creep of Object.values(Game.creeps)) {
    if (
      creep.memory.operationId === operation.id &&
      creep.memory.role === MINER_ROLE &&
      !indexedNames.has(creep.name)
    ) {
      result.push(creep)
    }
  }

  return result
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
