import {
  forEachCoordinateInRange,
  fromRoomIndex,
  toRoomIndex,
} from "../../world/map/roomGrid";
import {
  OUTSIDE_REGION_ID,
  TerrainRegion,
} from "../../world/map/terrainRegions";

export function selectBaseRegions(
  controller: StructureController,
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): Set<number> {
  const selectedRegionIds = new Set<number>();

  forEachCoordinateInRange(controller.pos, 1, (x, y) => {
    const index = toRoomIndex(x, y);
    const regionId = regionByTile[index];

    if (regionId >= 0) {
      selectedRegionIds.add(regionId);
    }
  });

  let numInnerTiles = 0;

  regions.forEach((region) => {
    if (selectedRegionIds.has(region.id)) {
      numInnerTiles += region.tileIndices.length;
    }
  });

  const connections = getTotalRegionConnections(regionByTile, regions);

  while (numInnerTiles < 100) {
    const candidates = getMergeCandidates(selectedRegionIds, connections);

    let bestCandidateId: number | undefined;
    let bestDelta = Infinity;
    let bestNumTiles = 0;

    for (const candidateId of candidates) {
      const delta = getMergeFrontierDelta(
        candidateId,
        selectedRegionIds,
        connections,
      );

      const candidateNumTiles =
        regions.find((region) => region.id === candidateId)?.tileIndices
          .length || 0;

      if (
        (delta <= 0 && delta < bestDelta) ||
        (bestDelta > 0 && candidateNumTiles / delta > bestNumTiles / bestDelta)
      ) {
        bestNumTiles = candidateNumTiles;
        bestCandidateId = candidateId;
        bestDelta = delta;
      }
    }

    if (bestCandidateId === undefined) {
      break;
    }

    selectedRegionIds.add(bestCandidateId);

    if (bestNumTiles) {
      numInnerTiles += bestNumTiles;
    }
  }

  return selectedRegionIds;
}

function getTotalRegionConnections(
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): Map<number, Map<number, number>> {
  const connections = new Map<number, Map<number, number>>();

  for (const region of regions) {
    connections.set(
      region.id,
      getAdjacentRegionConnections(region.id, regionByTile, regions),
    );
  }
  return connections;
}

function getAdjacentRegionConnections(
  regionId: number,
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
): Map<number, number> {
  const indices = [];

  for (const region of regions) {
    if (region.id === regionId) {
      indices.push(...region.tileIndices);
      break;
    }
  }

  const connections = new Map<number, number>();

  for (const index of indices) {
    forEachCoordinateInRange(fromRoomIndex(index), 1, (x, y) => {
      const neighborIndex = toRoomIndex(x, y);
      const neighborRegionId = regionByTile[neighborIndex];

      if (neighborRegionId < 0 || regionId === neighborRegionId) {
        return;
      }

      const current = connections.get(neighborRegionId) || 0;
      connections.set(neighborRegionId, current + 1);
    });
  }

  return connections;
}

function getMergeFrontierDelta(
  candidateRegionId: number,
  selectedRegionIds: Set<number>,
  connections: Map<number, Map<number, number>>,
): number {
  let delta = 0;

  const candidateConnections = connections.get(candidateRegionId);
  if (!candidateConnections) {
    return 0;
  }

  for (const [otherRegionId, connectionCount] of candidateConnections) {
    if (selectedRegionIds.has(otherRegionId)) {
      delta -= connectionCount;
    } else {
      delta += connectionCount;
    }
  }

  return delta;
}

function getMergeCandidates(
  selectedRegionIds: Set<number>,
  connections: Map<number, Map<number, number>>,
): Set<number> {
  const mergeCandidates = new Set<number>();

  for (const regionId of selectedRegionIds) {
    const adjacentRegionConnection = connections.get(regionId);

    if (adjacentRegionConnection === undefined) {
      continue;
    }

    for (const adjacentRegionId of adjacentRegionConnection.keys()) {
      if (
        adjacentRegionId !== OUTSIDE_REGION_ID &&
        !selectedRegionIds.has(adjacentRegionId)
      ) {
        mergeCandidates.add(adjacentRegionId);
      }
    }
  }

  return mergeCandidates;
}
