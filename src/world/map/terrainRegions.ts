import { PriorityQueue } from "../../utils/priorityQueue";
import type { RoomCoordinate } from "./roomCoordinate";
import { fromRoomIndex, ROOM_AREA, ROOM_SIZE, toRoomIndex } from "./roomGrid";

const UNASSIGNED = -1;

export const OUTSIDE_REGION_ID = 0;

const NEIGHBOR_OFFSETS: readonly RoomCoordinate[] = [
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
  readonly tileIndices: readonly number[];
  readonly peakIndices: readonly number[];
  readonly peakDistance: number;
}

export interface TerrainRegionsResult {
  readonly regionByTile: Int16Array;
  readonly regions: readonly TerrainRegion[];
}

interface MutableTerrainRegion {
  readonly id: number;
  readonly tileIndices: number[];
  readonly peakIndices: readonly number[];
  readonly peakDistance: number;
}

interface WatershedCandidate {
  readonly index: number;
  readonly regionId: number;
}

export function findTerrainRegions(
  distances: Uint8Array,
): TerrainRegionsResult {
  if (distances.length !== ROOM_AREA) {
    throw new Error(`Expected ${ROOM_AREA} distance values`);
  }

  const regionByTile = new Int16Array(ROOM_AREA);
  regionByTile.fill(UNASSIGNED);

  const regions: MutableTerrainRegion[] = [
    createOutsideRegion(distances, regionByTile),
  ];

  createPeakRegions(distances, regionByTile, regions);
  floodRegions(distances, regionByTile, regions);

  return { regionByTile, regions };
}

function createOutsideRegion(
  distances: Uint8Array,
  regionByTile: Int16Array,
): MutableTerrainRegion {
  const borderIndices: number[] = [];

  for (let x = 0; x < ROOM_SIZE; x++) {
    addOutsideSeed(toRoomIndex(x, 0), distances, regionByTile, borderIndices);
    addOutsideSeed(
      toRoomIndex(x, ROOM_SIZE - 1),
      distances,
      regionByTile,
      borderIndices,
    );
  }

  for (let y = 1; y < ROOM_SIZE - 1; y++) {
    addOutsideSeed(toRoomIndex(0, y), distances, regionByTile, borderIndices);
    addOutsideSeed(
      toRoomIndex(ROOM_SIZE - 1, y),
      distances,
      regionByTile,
      borderIndices,
    );
  }

  return {
    id: OUTSIDE_REGION_ID,
    tileIndices: borderIndices.slice(),
    peakIndices: borderIndices,
    peakDistance: 0,
  };
}

function addOutsideSeed(
  index: number,
  distances: Uint8Array,
  regionByTile: Int16Array,
  borderIndices: number[],
): void {
  if (distances[index] === 0) {
    return;
  }

  regionByTile[index] = OUTSIDE_REGION_ID;
  borderIndices.push(index);
}

function createPeakRegions(
  distances: Uint8Array,
  regionByTile: Int16Array,
  regions: MutableTerrainRegion[],
): void {
  const visited = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (
      visited[index] ||
      distances[index] === 0 ||
      regionByTile[index] !== UNASSIGNED
    ) {
      continue;
    }

    const distance = distances[index];
    const plateauIndices: number[] = [index];
    visited[index] = 1;

    let isLocalMaximum = true;
    let touchesExistingRegionAtSameDistance = false;
    let queueHead = 0;

    while (queueHead < plateauIndices.length) {
      const currentIndex = plateauIndices[queueHead];
      queueHead++;

      const currentCoordinate = fromRoomIndex(currentIndex);

      for (const offset of NEIGHBOR_OFFSETS) {
        const neighborX = currentCoordinate.x + offset.x;
        const neighborY = currentCoordinate.y + offset.y;

        if (!isInsideRoom(neighborX, neighborY)) {
          continue;
        }

        const neighborIndex = toRoomIndex(neighborX, neighborY);
        const neighborDistance = distances[neighborIndex];

        if (neighborDistance > distance) {
          isLocalMaximum = false;
        }

        if (neighborDistance !== distance) {
          continue;
        }

        if (regionByTile[neighborIndex] !== UNASSIGNED) {
          touchesExistingRegionAtSameDistance = true;
          continue;
        }

        if (visited[neighborIndex]) {
          continue;
        }

        visited[neighborIndex] = 1;
        plateauIndices.push(neighborIndex);
      }
    }

    if (!isLocalMaximum || touchesExistingRegionAtSameDistance) {
      continue;
    }

    const regionId = regions.length;
    const peakIndices = plateauIndices.slice();

    for (const peakIndex of peakIndices) {
      regionByTile[peakIndex] = regionId;
    }

    regions.push({
      id: regionId,
      tileIndices: peakIndices.slice(),
      peakIndices,
      peakDistance: distance,
    });
  }
}

function floodRegions(
  distances: Uint8Array,
  regionByTile: Int16Array,
  regions: MutableTerrainRegion[],
): void {
  const queue = new PriorityQueue<WatershedCandidate>();

  for (const region of regions) {
    for (const peakIndex of region.peakIndices) {
      enqueueUnassignedNeighbors(
        peakIndex,
        region.id,
        distances,
        regionByTile,
        queue,
      );
    }
  }

  while (queue.size > 0) {
    const candidate = queue.pop();

    if (candidate === undefined) {
      break;
    }

    const { index, regionId } = candidate;

    if (regionByTile[index] !== UNASSIGNED || distances[index] === 0) {
      continue;
    }

    regionByTile[index] = regionId;
    regions[regionId].tileIndices.push(index);

    enqueueUnassignedNeighbors(index, regionId, distances, regionByTile, queue);
  }
}

function enqueueUnassignedNeighbors(
  index: number,
  regionId: number,
  distances: Uint8Array,
  regionByTile: Int16Array,
  queue: PriorityQueue<WatershedCandidate>,
): void {
  const coordinate = fromRoomIndex(index);

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = coordinate.x + offset.x;
    const neighborY = coordinate.y + offset.y;

    if (!isInsideRoom(neighborX, neighborY)) {
      continue;
    }

    const neighborIndex = toRoomIndex(neighborX, neighborY);

    if (
      distances[neighborIndex] === 0 ||
      regionByTile[neighborIndex] !== UNASSIGNED
    ) {
      continue;
    }

    queue.push({ index: neighborIndex, regionId }, distances[neighborIndex]);
  }
}

function isInsideRoom(x: number, y: number): boolean {
  return x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;
}
