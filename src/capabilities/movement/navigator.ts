import { PriorityQueue } from "../../utils/priorityQueue"
import { getAdjacentRooms, getRoomManhattanDistance } from "../../world/map/roomTopology"
import { getRoomCostMatrix } from "./roomCostMatrix"

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
  const previousRooms = new Map<string, string>()

  costs.set(originRoomName, 0)

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

      while (roomName !== originRoomName) {
        const previousRoomName = previousRooms.get(roomName)

        if (previousRoomName === undefined) {
          return
        }

        reverseRoute.push(previousRoomName)
        roomName = previousRoomName
      }

      return reverseRoute.reverse()
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
      const bestCost = costs.get(adjacentRoomName)

      if (bestCost !== undefined && bestCost <= nextCost) {
        continue
      }

      const nextDistance = currentDistance + 1

      costs.set(adjacentRoomName, nextCost)
      previousRooms.set(adjacentRoomName, currentRoomName)

      const heuristic = getRoomManhattanDistance(adjacentRoomName, destinationRoomName)

      queue.push({ roomName: adjacentRoomName, cost: nextCost, distance: nextDistance }, nextCost + heuristic)
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
