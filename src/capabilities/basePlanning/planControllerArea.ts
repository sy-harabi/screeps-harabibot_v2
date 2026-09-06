import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  forEachCoordinateInRange,
  toRoomIndex,
} from "../../world/map/roomGrid";

export function findUpgradeTiles(
  controller: StructureController,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): RoomCoordinate[] {
  const upgradeTiles: RoomCoordinate[] = [];

  forEachCoordinateInRange(controller.pos, 3, (x, y) => {
    const index = toRoomIndex(x, y);
    if (selectedRegionIds.has(regionByTile[index])) {
      upgradeTiles.push({ x, y });
    }
  });

  return upgradeTiles;
}

export function findTerminalCandidates(
  controller: StructureController,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
) {
  let candidates: RoomCoordinate[] = [];
  let maxNumAdjacents = 0;

  forEachCoordinateAtRange(controller.pos, 4, (x, y) => {
    const index = toRoomIndex(x, y);
    const regionIndex = regionByTile[index];

    if (!selectedRegionIds.has(regionIndex)) {
      return;
    }

    let numAdjacents = 0;

    forEachCoordinateAtRange({ x, y }, 1, (nx, ny) => {
      if (getRange(controller.pos, { x: nx, y: ny }) > 3) {
        return;
      }

      const neighborIndex = toRoomIndex(nx, ny);
      const neighborRegionIndex = regionByTile[neighborIndex];

      if (!selectedRegionIds.has(neighborRegionIndex)) {
        return;
      }

      numAdjacents++;
    });

    if (numAdjacents === 0) {
      return;
    }

    if (numAdjacents > maxNumAdjacents) {
      maxNumAdjacents = numAdjacents;
      candidates = [{ x, y }];
    } else if (numAdjacents === maxNumAdjacents) {
      candidates.push({ x, y });
    }
  });

  return candidates;
}
