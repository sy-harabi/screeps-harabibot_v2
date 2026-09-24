import { PriorityQueue } from "../../utils/priorityQueue"
import type { RoomCoordinate } from "./roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, ROOM_AREA, toRoomIndex } from "./roomGrid"

/**
 * Builds minimum-cost distances from multiple starts.
 * Start coordinates may be on wall terrain.
 * Traversed tiles must be walkable and satisfy `canVisit`.
 * Unreachable tiles have distance -1.
 */
export function dijkstraMap(
  terrain: RoomTerrain,
  startCoordinates: readonly RoomCoordinate[],
  getCost: (x: number, y: number, terrainType: number) => number,
  canVisit?: (x: number, y: number) => boolean,
): Int32Array {
  const distances = new Int32Array(ROOM_AREA)
  distances.fill(-1)

  const queue = new PriorityQueue<number>()

  const visited = new Uint8Array(ROOM_AREA)

  for (const coordinate of startCoordinates) {
    const { x, y } = coordinate

    if (!isInsideRoom(x, y)) {
      continue
    }

    if (canVisit && !canVisit(x, y)) {
      continue
    }

    const index = toRoomIndex(coordinate.x, coordinate.y)

    if (distances[index] !== -1) {
      continue
    }

    queue.push(index, 0)
    distances[index] = 0
  }

  while (queue.size > 0) {
    const candidate = queue.pop()

    if (candidate === undefined) {
      break
    }

    const index = candidate

    if (visited[index]) {
      continue
    }

    visited[index] = 1

    const distance = distances[index]

    const coordinate = fromRoomIndex(index)

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = coordinate.x + offset.x
      const neighborY = coordinate.y + offset.y

      if (!isInsideRoom(neighborX, neighborY)) {
        continue
      }

      const terrainType = terrain.get(neighborX, neighborY)

      if (terrainType === TERRAIN_MASK_WALL) {
        continue
      }

      if (canVisit && !canVisit(neighborX, neighborY)) {
        continue
      }

      const cost = getCost(neighborX, neighborY, terrainType)

      const nextDistance = distance + cost

      const neighborIndex = toRoomIndex(neighborX, neighborY)

      if (distances[neighborIndex] !== -1 && nextDistance >= distances[neighborIndex]) {
        continue
      }

      distances[neighborIndex] = nextDistance

      queue.push(neighborIndex, nextDistance)
    }
  }

  return distances
}
