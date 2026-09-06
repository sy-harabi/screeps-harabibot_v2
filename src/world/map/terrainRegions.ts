import { distanceTransform } from "./distanceTransform";
import { ROOM_AREA } from "./roomGrid";

const UNASSIGNED = -1;
const BOUNDARY = -2;

export interface TerrainRegion {
  readonly id: number;
  readonly tileIndices: readonly number[];
  readonly peakIndices: readonly number[];
  readonly peakDistance: number;
}

export interface TerrainRegionsResult {
  readonly regionByTile: Int16Array;
  readonly regions: readonly TerrainRegion[];
}

export function findTerrainRegions(
  distances: Uint8Array,
): TerrainRegionsResult {
  const regionByTile = new Int16Array(ROOM_AREA);
  regionByTile.fill(UNASSIGNED);

  const tilesByDistance: number[][] = [];

  const regions: TerrainRegion[] = [];

  let maxDistance = 0;

  for (let index = 0; index < ROOM_AREA; index++) {
    const distance = distances[index];

    tilesByDistance[distance] ??= [];
    tilesByDistance[distance].push(index);

    maxDistance = Math.max(maxDistance, distance);
  }

  for (let distance = maxDistance; distance >= 1; distance--) {
    const indices = tilesByDistance[distance];

    for (const index of indices) {
      if (regionByTile[index] !== UNASSIGNED) {
        continue;
      }

      const visitedIndices = new Set();

      visitedIndices.add(index);
    }
  }

  return { regionByTile, regions };
}
