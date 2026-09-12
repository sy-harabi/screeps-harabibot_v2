import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";

export interface RegionBoundaryComponent {
  readonly externalRegionId: number;
  readonly tileIndices: readonly number[];
  readonly representativeTile: RoomCoordinate;
}

export function findRegionBoundaryComponents(
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
): RegionBoundaryComponent[] {
  const boundaryByExternalRegion = new Map<number, Set<number>>();

  for (let index = 0; index < ROOM_AREA; index++) {
    const regionId = regionByTile[index];

    if (!selectedRegionIds.has(regionId)) {
      continue;
    }

    const coordinate = fromRoomIndex(index);

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = coordinate.x + offset.x;
      const y = coordinate.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const externalRegionId = regionByTile[toRoomIndex(x, y)];

      if (externalRegionId < 0 || selectedRegionIds.has(externalRegionId)) {
        continue;
      }

      let boundaryTiles = boundaryByExternalRegion.get(externalRegionId);

      if (boundaryTiles === undefined) {
        boundaryTiles = new Set<number>();
        boundaryByExternalRegion.set(externalRegionId, boundaryTiles);
      }

      boundaryTiles.add(index);
    }
  }

  const components: RegionBoundaryComponent[] = [];

  for (const [externalRegionId, boundaryTiles] of boundaryByExternalRegion) {
    const unvisited = new Set(boundaryTiles);

    for (const startIndex of boundaryTiles) {
      if (!unvisited.delete(startIndex)) {
        continue;
      }

      const tileIndices = [startIndex];
      let queueHead = 0;

      while (queueHead < tileIndices.length) {
        const current = fromRoomIndex(tileIndices[queueHead]);
        queueHead++;

        for (const offset of NEIGHBOR_OFFSETS) {
          const x = current.x + offset.x;
          const y = current.y + offset.y;

          if (!isInsideRoom(x, y)) {
            continue;
          }

          const neighborIndex = toRoomIndex(x, y);

          if (!unvisited.delete(neighborIndex)) {
            continue;
          }

          tileIndices.push(neighborIndex);
        }
      }

      components.push({
        externalRegionId,
        tileIndices,
        representativeTile: findRepresentativeTile(tileIndices),
      });
    }
  }

  return components;
}

function findRepresentativeTile(tileIndices: readonly number[]): RoomCoordinate {
  let sumX = 0;
  let sumY = 0;

  for (const index of tileIndices) {
    const { x, y } = fromRoomIndex(index);
    sumX += x;
    sumY += y;
  }

  const numTiles = tileIndices.length;
  let bestIndex = tileIndices[0];
  let bestDistance = Infinity;

  for (const index of tileIndices) {
    const { x, y } = fromRoomIndex(index);
    const dx = x * numTiles - sumX;
    const dy = y * numTiles - sumY;
    const distance = dx * dx + dy * dy;

    if (
      distance < bestDistance ||
      (distance === bestDistance && index < bestIndex)
    ) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return fromRoomIndex(bestIndex);
}
