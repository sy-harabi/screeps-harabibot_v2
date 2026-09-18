import { PriorityQueue } from "../../utils/priorityQueue"
import { getAdjacentRooms, getRoomManhattanDistance } from "../../world/map/roomTopology"
import { getRoomCostMatrix } from "../../world/navigation/roomCostMatrix"

export interface MoveGoal {
  pos: RoomPosition
  range: number
}

interface FindRouteOptions {
  maxDistance?: number
  getRoomCost?: (roomName: string) => number
  shouldExpand?: (roomName: string) => boolean
}

interface RouteEntry {
  roomName: string
  cost: number
  distance: number
}

const DEFAULT_MAX_DISTANCE = 16

export function findRoute(
  originRoomName: string,
  destinationRoomName: string,
  options: FindRouteOptions = {},
): readonly string[] | undefined {
  if (originRoomName === destinationRoomName) {
    return [originRoomName]
  }

  const { maxDistance = DEFAULT_MAX_DISTANCE, getRoomCost, shouldExpand } = options

  const queue = new PriorityQueue<RouteEntry>()
  const costs = new Map<string, number>()
  const distances = new Map<string, number>()
  const previousRooms = new Map<string, string>()

  costs.set(originRoomName, 0)
  distances.set(originRoomName, 0)

  const initialHeuristic = getRoomManhattanDistance(originRoomName, destinationRoomName)

  queue.push({ roomName: originRoomName, cost: 0, distance: 0 }, initialHeuristic)

  while (queue.size > 0) {
    const currentEntry = queue.pop()!

    const currentRoomName = currentEntry.roomName
    const currentCost = currentEntry.cost

    if (costs.get(currentRoomName) !== currentCost) {
      continue
    }

    if (currentRoomName === destinationRoomName) {
      const reverseRoute = [destinationRoomName]

      let roomName = destinationRoomName

      while (true) {
        const previousRoomName = previousRooms.get(roomName)
        if (!previousRoomName) {
          return reverseRoute.reverse()
        }
        reverseRoute.push(previousRoomName)
      }
    }

    const currentDistance = currentEntry.distance

    if (currentDistance >= maxDistance) {
      continue
    }

    const minRemainingDistance = getRoomManhattanDistance(currentRoomName, destinationRoomName)

    if (currentDistance + minRemainingDistance > maxDistance) {
      continue
    }

    if (shouldExpand && !shouldExpand(currentRoomName)) {
      continue
    }

    for (const adjacentRoomName of getAdjacentRooms(currentRoomName)) {
      const nextCost = currentCost + (getRoomCost ? getRoomCost(adjacentRoomName) : 1)
      const bestCost = costs.get(adjacentRoomName)!

      if (bestCost <= nextCost) {
        continue
      }

      costs.set(adjacentRoomName, nextCost)
      distances.set(adjacentRoomName, currentDistance + 1)
      previousRooms.set(adjacentRoomName, currentRoomName)

      const heuristic = getRoomManhattanDistance(adjacentRoomName, destinationRoomName)

      queue.push({ roomName: adjacentRoomName, cost: nextCost, distance: currentDistance + 1 }, nextCost + heuristic)
    }
  }

  return
}

type MoveGoals = MoveGoal | MoveGoal[]

export type MoveStatus = "arrived" | "pending" | "failed"

export function findPath(origin: RoomPosition, goals: MoveGoals): readonly RoomPosition[] | undefined {
  const result = PathFinder.search(origin, goals, {
    maxRooms: 1,
    plainCost: 2,
    swampCost: 10,
    roomCallback: (roomName: string) => getRoomCostMatrix(roomName) || true,
  })

  if (result.incomplete) {
    return
  }

  return result.path
}
