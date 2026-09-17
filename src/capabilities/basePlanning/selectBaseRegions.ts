import { forEachCoordinateInRange, fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"
import { OUTSIDE_REGION_ID, TerrainRegion } from "../../world/map/terrainRegions"

const MIN_INNER_TILES = 150

interface MergeCandidate {
  readonly regionId: number
  readonly numTiles: number
  readonly frontierDelta: number
}

export interface BaseRegionSelection {
  readonly selectedRegionIds: Set<number>
  addNextRegion(): boolean
}

export function createBaseRegionSelection(
  controller: StructureController,
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): BaseRegionSelection {
  const selectedRegionIds = getControllerAdjacentRegionIds(controller, regionByTile)
  const regionTileCounts = getRegionTileCounts(regions)
  const connections = getTotalRegionConnections(regionByTile, regions)

  let numInnerTiles = getSelectedTileCount(selectedRegionIds, regionTileCounts)

  const addNextRegion = (): boolean => {
    const candidate = getBestMergeCandidate(selectedRegionIds, regionTileCounts, connections)

    if (candidate === undefined) {
      return false
    }

    selectedRegionIds.add(candidate.regionId)
    numInnerTiles += candidate.numTiles
    return true
  }

  while (numInnerTiles < MIN_INNER_TILES && addNextRegion()) {
    // Keep expanding from the current frontier until the initial area is large enough.
  }

  return {
    selectedRegionIds,
    addNextRegion,
  }
}

/**
 * Returns the initial region selection kept for callers that only need one
 * selection instead of planner retry expansion.
 */
export function selectBaseRegions(
  controller: StructureController,
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): Set<number> {
  return createBaseRegionSelection(controller, regionByTile, regions).selectedRegionIds
}

function getControllerAdjacentRegionIds(controller: StructureController, regionByTile: Int16Array): Set<number> {
  const selectedRegionIds = new Set<number>()

  forEachCoordinateInRange(controller.pos, 1, (x, y) => {
    const index = toRoomIndex(x, y)
    const regionId = regionByTile[index]

    if (regionId > OUTSIDE_REGION_ID) {
      selectedRegionIds.add(regionId)
    }
  })

  return selectedRegionIds
}

function getRegionTileCounts(regions: readonly TerrainRegion[]): Map<number, number> {
  const tileCounts = new Map<number, number>()

  for (const region of regions) {
    tileCounts.set(region.id, region.tileIndices.length)
  }

  return tileCounts
}

function getSelectedTileCount(
  selectedRegionIds: ReadonlySet<number>,
  regionTileCounts: ReadonlyMap<number, number>,
): number {
  let numTiles = 0

  for (const regionId of selectedRegionIds) {
    numTiles += regionTileCounts.get(regionId) ?? 0
  }

  return numTiles
}

function getBestMergeCandidate(
  selectedRegionIds: ReadonlySet<number>,
  regionTileCounts: ReadonlyMap<number, number>,
  connections: ReadonlyMap<number, ReadonlyMap<number, number>>,
): MergeCandidate | undefined {
  const candidateIds = getMergeCandidates(selectedRegionIds, connections)
  let bestCandidate: MergeCandidate | undefined

  for (const candidateId of candidateIds) {
    const candidate: MergeCandidate = {
      regionId: candidateId,
      numTiles: regionTileCounts.get(candidateId) ?? 0,
      frontierDelta: getMergeFrontierDelta(candidateId, selectedRegionIds, connections),
    }

    if (bestCandidate === undefined || isBetterMergeCandidate(candidate, bestCandidate)) {
      bestCandidate = candidate
    }
  }

  return bestCandidate
}

function isBetterMergeCandidate(candidate: MergeCandidate, currentBest: MergeCandidate): boolean {
  const candidateHasNonPositiveDelta = candidate.frontierDelta <= 0
  const currentBestHasNonPositiveDelta = currentBest.frontierDelta <= 0

  if (candidateHasNonPositiveDelta !== currentBestHasNonPositiveDelta) {
    return candidateHasNonPositiveDelta
  }

  if (candidateHasNonPositiveDelta) {
    if (candidate.numTiles !== currentBest.numTiles) {
      return candidate.numTiles > currentBest.numTiles
    }

    if (candidate.frontierDelta !== currentBest.frontierDelta) {
      return candidate.frontierDelta < currentBest.frontierDelta
    }

    return candidate.regionId < currentBest.regionId
  }

  const candidateValue = candidate.numTiles * currentBest.frontierDelta
  const currentBestValue = currentBest.numTiles * candidate.frontierDelta

  if (candidateValue !== currentBestValue) {
    return candidateValue > currentBestValue
  }

  if (candidate.numTiles !== currentBest.numTiles) {
    return candidate.numTiles > currentBest.numTiles
  }

  if (candidate.frontierDelta !== currentBest.frontierDelta) {
    return candidate.frontierDelta < currentBest.frontierDelta
  }

  return candidate.regionId < currentBest.regionId
}

function getTotalRegionConnections(
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): Map<number, Map<number, number>> {
  const connections = new Map<number, Map<number, number>>()

  for (const region of regions) {
    connections.set(region.id, getAdjacentRegionConnections(region, regionByTile))
  }

  return connections
}

function getAdjacentRegionConnections(region: TerrainRegion, regionByTile: Int16Array): Map<number, number> {
  const connections = new Map<number, number>()

  for (const index of region.tileIndices) {
    forEachCoordinateInRange(fromRoomIndex(index), 1, (x, y) => {
      const neighborIndex = toRoomIndex(x, y)
      const neighborRegionId = regionByTile[neighborIndex]

      if (neighborRegionId < 0 || region.id === neighborRegionId) {
        return
      }

      const current = connections.get(neighborRegionId) ?? 0
      connections.set(neighborRegionId, current + 1)
    })
  }

  return connections
}

function getMergeFrontierDelta(
  candidateRegionId: number,
  selectedRegionIds: ReadonlySet<number>,
  connections: ReadonlyMap<number, ReadonlyMap<number, number>>,
): number {
  let delta = 0

  const candidateConnections = connections.get(candidateRegionId)
  if (candidateConnections === undefined) {
    return 0
  }

  for (const [otherRegionId, connectionCount] of candidateConnections) {
    if (selectedRegionIds.has(otherRegionId)) {
      delta -= connectionCount
    } else {
      delta += connectionCount
    }
  }

  return delta
}

function getMergeCandidates(
  selectedRegionIds: ReadonlySet<number>,
  connections: ReadonlyMap<number, ReadonlyMap<number, number>>,
): Set<number> {
  const mergeCandidates = new Set<number>()

  for (const regionId of selectedRegionIds) {
    const adjacentRegionConnections = connections.get(regionId)

    if (adjacentRegionConnections === undefined) {
      continue
    }

    for (const adjacentRegionId of adjacentRegionConnections.keys()) {
      if (adjacentRegionId !== OUTSIDE_REGION_ID && !selectedRegionIds.has(adjacentRegionId)) {
        mergeCandidates.add(adjacentRegionId)
      }
    }
  }

  return mergeCandidates
}
