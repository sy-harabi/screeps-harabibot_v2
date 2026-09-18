import { getAdjacentRooms } from "./roomTopology"

interface FloodRoomsOptions {
  maxDepth: number
  canExpand?: (roomName: string, fromRoomName: string) => boolean
}

interface FloodRoomsResult {
  distance: Map<string, number>
  previous: Map<string, string>
  rooms: string[]
}

const DEFAULT_MAX_DEPTH = 16

export function floodRooms(
  origin: string,
  options: FloodRoomsOptions = { maxDepth: DEFAULT_MAX_DEPTH },
): FloodRoomsResult {
  const maxDepth = options.maxDepth

  const distance = new Map<string, number>()
  const previous = new Map<string, string>()
  const rooms: string[] = [origin]

  const queue = [origin]
  distance.set(origin, 0)

  let head = 0

  while (head < queue.length) {
    const current = queue[head]
    head++

    const currentDistance = distance.get(current) || 0

    if (currentDistance >= maxDepth) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(current)) {
      if (distance.get(adjacentRoomName) !== undefined) {
        continue
      }

      distance.set(adjacentRoomName, currentDistance + 1)
      previous.set(adjacentRoomName, current)

      queue.push(adjacentRoomName)
    }
  }

  return { distance, previous, rooms }
}
