import { PriorityQueue } from "../../utils/priorityQueue"
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

interface SearchRoomsOptions {
  maxDistance?: number
  maxVisitedRooms?: number

  isTarget: (roomName: string) => boolean
  getRoomCost?: (roomName: string) => number
  shouldExpand?: (roomName: string) => boolean
}

interface SearchRoomsResult {
  roomNames: string[]
  costs: Map<string, number>
  distances: Map<string, number>
  previousRooms: Map<string, string>
}

interface SearchEntry {
  roomName: string
  cost: number
  distance: number
}

const DEFAULT_MAX_DISTANCE = 16
const DEFAULT_MAX_VISITED_ROOMS = 100

export function searchRooms(origin: string, options: SearchRoomsOptions): SearchRoomsResult {
  const {
    maxDistance = DEFAULT_MAX_DISTANCE,
    maxVisitedRooms = DEFAULT_MAX_VISITED_ROOMS,
    isTarget,
    getRoomCost,
    shouldExpand,
  } = options

  const roomNames = []
  const costs = new Map<string, number>()
  const distances = new Map<string, number>()
  const previousRooms = new Map<string, string>()

  const queue = new PriorityQueue<SearchEntry>()
  queue.push({ roomName: origin, cost: 0, distance: 0 }, 0)
  costs.set(origin, 0)
  distances.set(origin, 0)

  let visited = 0

  while (queue.size > 0) {
    const currentEntry = queue.pop()!
    const currentRoomName = currentEntry.roomName

    if (isTarget(currentRoomName)) {
      roomNames.push(currentRoomName)
    }

    const currentCost = currentEntry.cost
    const currentDistance = currentEntry.distance
    visited++

    if (visited >= maxVisitedRooms) {
      break
    }

    if (costs.get(currentRoomName) !== currentCost || currentDistance >= maxDistance) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(currentRoomName)) {
      const costNew = currentCost + (getRoomCost ? getRoomCost(adjacentRoomName) : 1)
      const costBefore = costs.get(adjacentRoomName)

      if (costBefore !== undefined && costBefore <= costNew) {
        continue
      }

      costs.set(adjacentRoomName, costNew)
      distances.set(adjacentRoomName, currentDistance + 1)
      previousRooms.set(adjacentRoomName, currentRoomName)

      if (shouldExpand && !shouldExpand(adjacentRoomName)) {
        continue
      }

      queue.push({ roomName: adjacentRoomName, cost: costNew, distance: currentDistance + 1 }, costNew)
    }
  }

  return { roomNames, costs, distances, previousRooms }
}

export function floodRooms(origin: string, options: FloodRoomsOptions): FloodRoomsResult {
  const maxDistance = options?.maxDistance ?? DEFAULT_MAX_DISTANCE

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
