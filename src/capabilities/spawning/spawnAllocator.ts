import { getTickContext } from "../../kernel/tickContext"
import { compareSpawnPriority } from "./spawnPriority"
import { getSpawnRoomStates, SpawnRoomState } from "./spawnQueue"
import { SpawnRequest } from "./spawnRequest"

export function allocateSpawns(): void {
  const roomStates = getSpawnRoomStates()

  for (const [roomName, state] of roomStates) {
    allocateRoomSpawns(roomName, state)
  }
}

function allocateRoomSpawns(roomName: string, state: SpawnRoomState): void {
  const requests = [...state.spawnRequests].sort((left, right) => compareSpawnPriority(left.priority, right.priority))

  const room = getTickContext().ownedRooms.get(roomName)

  if (!room) {
    return
  }

  let requestIndex = 0

  for (const spawn of state.freeSpawns) {
    while (requestIndex < requests.length) {
      const request = requests[requestIndex]
      requestIndex++

      if (getBodyCost(request.body) > spawn.room.energyCapacityAvailable) {
        continue
      }

      const result = spawn.spawnCreep(request.body as BodyPartConstant[], generateCreepName(request, spawn), {
        memory: request.memory,
      })

      if (result === OK) {
        break
      }

      if (result === ERR_NOT_ENOUGH_ENERGY) {
        return
      }
    }
  }
}

function generateCreepName(request: SpawnRequest, spawn: StructureSpawn): string {
  return `${request.role}_${Game.time}_${spawn.name}`
}

function getBodyCost(body: readonly BodyPartConstant[]): number {
  let cost = 0

  for (const part of body) {
    cost += BODYPART_COST[part]
  }

  return cost
}
