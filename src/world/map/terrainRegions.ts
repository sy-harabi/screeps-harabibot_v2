import { RoomCoordinate } from "./roomCoordinate";
import { fromRoomIndex, ROOM_AREA, ROOM_SIZE, toRoomIndex } from "./roomGrid";

const UNASSIGNED = -1;
const BOUNDARY = -2;

export const NEIGHBOR_OFFSETS: readonly RoomCoordinate[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export interface TerrainRegion {
  readonly id: number;
  readonly tileIndices: number[];
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

  const visited = new Uint8Array(ROOM_AREA);

  const regions: TerrainRegion[] = [];

  let maxDistance = 0;

  for (let index = 0; index < ROOM_AREA; index++) {
    const distance = distances[index];

    tilesByDistance[distance] ??= [];
    tilesByDistance[distance].push(index);

    maxDistance = Math.max(maxDistance, distance);
  }

  let currentRegionId = 0;

  for (let distance = maxDistance; distance >= 1; distance--) {
    const indices = tilesByDistance[distance] ?? [];

    for (const index of indices) {
      if (visited[index]) {
        continue;
      }

      const plateauIndices: number[] = [index];
      visited[index] = 1;

      let queueHead = 0;

      while (queueHead < plateauIndices.length) {
        const currentIndex = plateauIndices[queueHead];
        queueHead++;

        const currentCoordinate = fromRoomIndex(currentIndex);

        for (const offset of NEIGHBOR_OFFSETS) {
          const neighborX = currentCoordinate.x + offset.x;
          const neighborY = currentCoordinate.y + offset.y;

          if (
            neighborX < 0 ||
            neighborX >= ROOM_SIZE ||
            neighborY < 0 ||
            neighborY >= ROOM_SIZE
          ) {
            continue;
          }

          const neighborIndex = toRoomIndex(neighborX, neighborY);

          if (visited[neighborIndex]) {
            continue;
          }

          if (distances[neighborIndex] !== distance) {
            continue;
          }

          visited[neighborIndex] = 1;
          plateauIndices.push(neighborIndex);
        }
      }

      const adjacentRegionIds = new Set<number>();

      for (const currentIndex of plateauIndices) {
        const currentCoordinate = fromRoomIndex(currentIndex);

        for (const offset of NEIGHBOR_OFFSETS) {
          const neighborX = currentCoordinate.x + offset.x;
          const neighborY = currentCoordinate.y + offset.y;

          if (
            neighborX < 0 ||
            neighborX >= ROOM_SIZE ||
            neighborY < 0 ||
            neighborY >= ROOM_SIZE
          ) {
            continue;
          }

          const neighborIndex = toRoomIndex(neighborX, neighborY);
          const regionId = regionByTile[neighborIndex];
          if (regionId >= 0) {
            adjacentRegionIds.add(regionId);
          }
        }
      }

      if (adjacentRegionIds.size === 0) {
        plateauIndices.forEach(
          (index) => (regionByTile[index] = currentRegionId),
        );

        regions.push({
          id: currentRegionId,
          tileIndices: plateauIndices,
          peakIndices: plateauIndices,
          peakDistance: distance,
        });

        currentRegionId++;
      } else if (adjacentRegionIds.size === 1) {
        const [regionId] = adjacentRegionIds;
        plateauIndices.forEach((index) => (regionByTile[index] = regionId));

        const region = regions[regionId];
        region.tileIndices.push(...plateauIndices);
      } else {
        plateauIndices.forEach((index) => (regionByTile[index] = BOUNDARY));
      }
    }
  }

  return { regionByTile, regions };
}
