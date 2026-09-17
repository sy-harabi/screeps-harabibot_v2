import { type RoomCoordinate } from "./roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, ROOM_AREA, ROOM_SIZE, toRoomIndex } from "./roomGrid"

export interface FloodFillResult {
  /**
   * Minimum steps from any accepted start, indexed by `y * ROOM_SIZE + x`.
   * Starts have distance 0; blocked and unreachable tiles have distance -1.
   */
  readonly distances: Int16Array

  /** Tile indices in discovery order, including starts, without duplicates. */
  readonly visitedIndices: readonly number[]
}

/**
 * Explores reachable tiles using breadth-first search over eight neighbors.
 * Diagonal and cardinal steps both count as one; plains and swamps are treated alike.
 * Terrain walls are always excluded. Terrain is read without copying or mutation.
 *
 * @param startCoordinates Valid room coordinates. Duplicate starts are visited once;
 * starts blocked by terrain or rejected by `canVisit` are skipped.
 * @param canVisit Optional additional filter for both starts and neighbors.
 * It must return consistent results throughout the search.
 * @returns Distances and discovery order. With no accepted starts, the order is
 * empty and all distances are -1.
 */
export function floodFill(
  terrain: RoomTerrain,
  startCoordinates: readonly RoomCoordinate[],
  canVisit?: (x: number, y: number) => boolean,
): FloodFillResult {
  const distances = new Int16Array(ROOM_AREA)
  distances.fill(-1)

  // Use discovery order as the queue to avoid a second array and Array.shift().
  const visitedIndices: number[] = []

  for (const startCoordinate of startCoordinates) {
    const { x, y } = startCoordinate

    if (!isInsideRoom(x, y)) {
      continue
    }

    const index = toRoomIndex(x, y)

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      continue
    }

    if (canVisit && !canVisit(x, y)) {
      continue
    }

    if (distances[index] !== -1) {
      continue
    }

    distances[index] = 0
    visitedIndices.push(index)
  }

  let queueHead = 0

  while (queueHead < visitedIndices.length) {
    const currentIndex = visitedIndices[queueHead]
    queueHead++
    const currentCoordinate = fromRoomIndex(currentIndex)

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = currentCoordinate.x + offset.x
      const neighborY = currentCoordinate.y + offset.y

      if (!isInsideRoom(neighborX, neighborY)) {
        continue
      }

      const neighborIndex = toRoomIndex(neighborX, neighborY)

      if (distances[neighborIndex] !== -1) {
        continue
      }

      if (terrain.get(neighborX, neighborY) === TERRAIN_MASK_WALL) {
        continue
      }

      if (canVisit && !canVisit(neighborX, neighborY)) {
        continue
      }

      distances[neighborIndex] = distances[currentIndex] + 1
      visitedIndices.push(neighborIndex)
    }
  }

  return { distances, visitedIndices }
}
