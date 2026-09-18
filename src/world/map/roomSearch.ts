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
  getRoomCost?: (roomName: string) => number
  shouldExpand?: (roomName: string) => boolean
}

interface SearchRoomsResult {
  targetRoomNames: string[]
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

export function searchRooms(
  originRoomName: string,
  isTarget: (roomName: string) => boolean,
  options: SearchRoomsOptions = {},
): SearchRoomsResult {
  const { maxDistance = DEFAULT_MAX_DISTANCE, maxVisitedRooms, getRoomCost, shouldExpand } = options

  const targetRoomNames = []
  const costs = new Map<string, number>()
  const distances = new Map<string, number>()
  const previousRooms = new Map<string, string>()

  const queue = new PriorityQueue<SearchEntry>()
  queue.push({ roomName: originRoomName, cost: 0, distance: 0 }, 0)
  costs.set(originRoomName, 0)
  distances.set(originRoomName, 0)

  let visitedRoomCount = 0

  while (queue.size > 0 && (maxVisitedRooms === undefined || visitedRoomCount < maxVisitedRooms)) {
    const currentEntry = queue.pop()!
    const currentRoomName = currentEntry.roomName
    const currentCost = currentEntry.cost
    const currentDistance = currentEntry.distance

    if (costs.get(currentRoomName) !== currentCost) {
      continue
    }

    visitedRoomCount++

    if (isTarget(currentRoomName)) {
      targetRoomNames.push(currentRoomName)
    }

    if (currentDistance >= maxDistance) {
      continue
    }

    if (shouldExpand && !shouldExpand(currentRoomName)) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(currentRoomName)) {
      const nextCost = currentCost + (getRoomCost ? getRoomCost(adjacentRoomName) : 1)
      const bestCost = costs.get(adjacentRoomName)

      if (bestCost !== undefined && bestCost <= nextCost) {
        continue
      }

      costs.set(adjacentRoomName, nextCost)
      distances.set(adjacentRoomName, currentDistance + 1)
      previousRooms.set(adjacentRoomName, currentRoomName)

      queue.push({ roomName: adjacentRoomName, cost: nextCost, distance: currentDistance + 1 }, nextCost)
    }
  }

  return { targetRoomNames, costs, distances, previousRooms }
}

export function floodRooms(origin: string, options: FloodRoomsOptions = {}): FloodRoomsResult {
  const { maxDistance = DEFAULT_MAX_DISTANCE, shouldExpand } = options

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

    if (shouldExpand && !shouldExpand(currentRoomName)) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(currentRoomName)) {
      if (distances.has(adjacentRoomName)) {
        continue
      }

      distances.set(adjacentRoomName, currentDistance + 1)
      previousRooms.set(adjacentRoomName, currentRoomName)
      roomNames.push(adjacentRoomName)

      queue.push(adjacentRoomName)
    }
  }

  return { distances, previousRooms, roomNames }
}
