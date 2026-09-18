import { getAdjacentRooms } from "./roomTopology"

interface FloodRoomsOptions {
  maxDistance?: number
  shouldExpand?: (roomName: string) => boolean
}

interface FloodRoomsResult {
  distances: Map<string, number>
  previousRooms: Map<string, string>
  roomNames: string[]
}

const DEFAULT_MAX_DISTANCE = 16

export function floodRooms(origin: string, options: FloodRoomsOptions = {}): FloodRoomsResult {
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE

  const distances = new Map<string, number>()
  const previousRooms = new Map<string, string>()
  const roomNames: string[] = [origin]

  const queue = [origin]
  distances.set(origin, 0)

  let head = 0

  while (head < queue.length) {
    const currentRoomName = queue[head]
    head++
    const currentDistance = distances.get(currentRoomName)!

    if (currentDistance >= maxDistance) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(currentRoomName)) {
      if (distances.has(adjacentRoomName)) {
        continue
      }

      distances.set(adjacentRoomName, currentDistance + 1)
      previousRooms.set(adjacentRoomName, currentRoomName)
      roomNames.push(adjacentRoomName)

      if (!options.shouldExpand || options.shouldExpand(adjacentRoomName)) {
        queue.push(adjacentRoomName)
      }
    }
  }

  return { distances, previousRooms, roomNames }
}
