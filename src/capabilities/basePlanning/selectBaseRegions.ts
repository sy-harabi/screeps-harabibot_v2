import {
  forEachCoordinateInRange,
  fromRoomIndex,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { TerrainRegion } from "../../world/map/terrainRegions";

export function selectBaseRegions(
  controller: StructureController,
  regionByTile: Int16Array,
  regions: TerrainRegion[],
): Set<number> {
  const selectedRegionIds = new Set<number>();

  forEachCoordinateInRange(controller.pos, 1, (x, y) => {
    const index = toRoomIndex(x, y);
    const regionId = regionByTile[index];

    if (regionId >= 0) {
      selectedRegionIds.add(regionId);
    }
  });

  return selectedRegionIds;
}

function getTotalRegionConnections(
  regionByTile: Int16Array,
  regions: TerrainRegion[],
): Map<number, Map<number, number>> {
  const connections = new Map();

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
  regions: TerrainRegion[],
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

      if (regionId === neighborRegionId) {
        return;
      }

      const current = connections.get(neighborRegionId) || 0;
      connections.set(neighborRegionId, current + 1);
    });
  }

  return connections;
}
