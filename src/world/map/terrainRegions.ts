import { PriorityQueue } from "../../utils/priorityQueue"
import { floodFill } from "./floodFill"
import type { RoomCoordinate } from "./roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, ROOM_AREA, ROOM_SIZE, toRoomIndex } from "./roomGrid"

const UNASSIGNED = -1

export const OUTSIDE_REGION_ID = 0

export interface TerrainRegion {
  readonly id: number
  readonly tileIndices: readonly number[]
  readonly peakIndices: readonly number[]
  readonly peakDistance: number
}

export interface TerrainRegionsResult {
  readonly regionByTile: Int16Array
  readonly regions: readonly TerrainRegion[]
}

interface MutableTerrainRegion {
  readonly id: number
  readonly tileIndices: number[]
  readonly peakIndices: readonly number[]
  readonly peakDistance: number
}

interface WatershedCandidate {
  readonly index: number
  readonly regionId: number
}

export function findTerrainRegions(
  terrain: RoomTerrain,
  distances: Uint8Array,
  opts = { minPeakDistance: 4 },
): TerrainRegionsResult {
  if (distances.length !== ROOM_AREA) {
    throw new Error(`Expected ${ROOM_AREA} distance values`)
  }

  const { minPeakDistance } = opts

  const edgeDistances = findEdgeDistances(terrain)

  const regionByTile = new Int16Array(ROOM_AREA)
  regionByTile.fill(UNASSIGNED)

  const regions: MutableTerrainRegion[] = [createOutsideRegion(distances, regionByTile)]

  createPeakRegions(distances, edgeDistances, regionByTile, regions, minPeakDistance)
  floodRegions(distances, edgeDistances, regionByTile, regions)

  return { regionByTile, regions }
}

function findEdgeDistances(terrain: RoomTerrain): Int16Array {
  const edgeCoordinates: RoomCoordinate[] = []

  for (let x = 0; x < ROOM_SIZE; x++) {
    edgeCoordinates.push({ x, y: 0 })
    edgeCoordinates.push({ x, y: ROOM_SIZE - 1 })
  }

  for (let y = 1; y < ROOM_SIZE - 1; y++) {
    edgeCoordinates.push({ x: 0, y })
    edgeCoordinates.push({ x: ROOM_SIZE - 1, y })
  }

  return floodFill(terrain, edgeCoordinates).distances
}

function createOutsideRegion(distances: Uint8Array, regionByTile: Int16Array): MutableTerrainRegion {
  const seedIndices: number[] = []

  for (let x = 0; x < ROOM_SIZE; x++) {
    addOutsideSeedArea(x, 0, distances, regionByTile, seedIndices)
    addOutsideSeedArea(x, ROOM_SIZE - 1, distances, regionByTile, seedIndices)
  }

  for (let y = 1; y < ROOM_SIZE - 1; y++) {
    addOutsideSeedArea(0, y, distances, regionByTile, seedIndices)
    addOutsideSeedArea(ROOM_SIZE - 1, y, distances, regionByTile, seedIndices)
  }

  return {
    id: OUTSIDE_REGION_ID,
    tileIndices: seedIndices.slice(),
    peakIndices: seedIndices,
    peakDistance: 0,
  }
}

function addOutsideSeedArea(
  edgeX: number,
  edgeY: number,
  distances: Uint8Array,
  regionByTile: Int16Array,
  seedIndices: number[],
): void {
  const edgeIndex = toRoomIndex(edgeX, edgeY)

  if (distances[edgeIndex] === 0) {
    return
  }

  addOutsideSeed(edgeIndex, distances, regionByTile, seedIndices)

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = edgeX + offset.x
    const neighborY = edgeY + offset.y

    if (!isInsideRoom(neighborX, neighborY)) {
      continue
    }

    addOutsideSeed(toRoomIndex(neighborX, neighborY), distances, regionByTile, seedIndices)
  }
}

function addOutsideSeed(index: number, distances: Uint8Array, regionByTile: Int16Array, seedIndices: number[]): void {
  if (distances[index] === 0 || regionByTile[index] === OUTSIDE_REGION_ID) {
    return
  }

  regionByTile[index] = OUTSIDE_REGION_ID
  seedIndices.push(index)
}

function createPeakRegions(
  distances: Uint8Array,
  edgeDistances: Int16Array,
  regionByTile: Int16Array,
  regions: MutableTerrainRegion[],
  minPeakDistance: number,
): void {
  const visited = new Uint8Array(ROOM_AREA)

  for (let index = 0; index < ROOM_AREA; index++) {
    if (visited[index] || distances[index] === 0 || regionByTile[index] !== UNASSIGNED) {
      continue
    }

    const plateauIndices: number[] = [index]
    visited[index] = 1

    let isPeak = distances[index] >= minPeakDistance
    let queueHead = 0

    while (queueHead < plateauIndices.length) {
      const currentIndex = plateauIndices[queueHead]
      queueHead++

      const currentCoordinate = fromRoomIndex(currentIndex)

      for (const offset of NEIGHBOR_OFFSETS) {
        const neighborX = currentCoordinate.x + offset.x
        const neighborY = currentCoordinate.y + offset.y

        if (!isInsideRoom(neighborX, neighborY)) {
          continue
        }

        const neighborIndex = toRoomIndex(neighborX, neighborY)

        if (distances[neighborIndex] === 0) {
          continue
        }

        const comparison = compareWatershedHeight(neighborIndex, index, distances, edgeDistances)

        if (comparison > 0) {
          isPeak = false
        }

        if (comparison !== 0 || visited[neighborIndex] || regionByTile[neighborIndex] !== UNASSIGNED) {
          continue
        }

        visited[neighborIndex] = 1
        plateauIndices.push(neighborIndex)
      }
    }

    if (!isPeak) {
      continue
    }

    const regionId = regions.length
    const peakIndices = plateauIndices.slice()

    for (const peakIndex of peakIndices) {
      regionByTile[peakIndex] = regionId
    }

    regions.push({
      id: regionId,
      tileIndices: peakIndices.slice(),
      peakIndices,
      peakDistance: distances[index],
    })
  }
}

function floodRegions(
  distances: Uint8Array,
  edgeDistances: Int16Array,
  regionByTile: Int16Array,
  regions: MutableTerrainRegion[],
): void {
  const queue = new PriorityQueue<WatershedCandidate>()

  for (const region of regions) {
    for (const peakIndex of region.peakIndices) {
      enqueueUnassignedNeighbors(peakIndex, region.id, distances, edgeDistances, regionByTile, queue)
    }
  }

  while (queue.size > 0) {
    const candidate = queue.pop()

    if (candidate === undefined) {
      break
    }

    const { index, regionId } = candidate

    if (regionByTile[index] !== UNASSIGNED || distances[index] === 0) {
      continue
    }

    regionByTile[index] = regionId
    regions[regionId].tileIndices.push(index)

    enqueueUnassignedNeighbors(index, regionId, distances, edgeDistances, regionByTile, queue)
  }
}

function enqueueUnassignedNeighbors(
  index: number,
  regionId: number,
  distances: Uint8Array,
  edgeDistances: Int16Array,
  regionByTile: Int16Array,
  queue: PriorityQueue<WatershedCandidate>,
): void {
  const coordinate = fromRoomIndex(index)

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = coordinate.x + offset.x
    const neighborY = coordinate.y + offset.y

    if (!isInsideRoom(neighborX, neighborY)) {
      continue
    }

    const neighborIndex = toRoomIndex(neighborX, neighborY)

    if (distances[neighborIndex] === 0 || regionByTile[neighborIndex] !== UNASSIGNED) {
      continue
    }

    queue.push({ index: neighborIndex, regionId }, -getWatershedPriority(neighborIndex, distances, edgeDistances))
  }
}

function compareWatershedHeight(
  firstIndex: number,
  secondIndex: number,
  distances: Uint8Array,
  edgeDistances: Int16Array,
): number {
  const distanceDifference = distances[firstIndex] - distances[secondIndex]

  if (distanceDifference !== 0) {
    return distanceDifference
  }

  return getEdgeDepth(firstIndex, edgeDistances) - getEdgeDepth(secondIndex, edgeDistances)
}

function getWatershedPriority(index: number, distances: Uint8Array, edgeDistances: Int16Array): number {
  return distances[index] * (ROOM_AREA + 1) + getEdgeDepth(index, edgeDistances)
}

function getEdgeDepth(index: number, edgeDistances: Int16Array): number {
  const edgeDistance = edgeDistances[index]
  return edgeDistance === -1 ? ROOM_AREA : edgeDistance
}
