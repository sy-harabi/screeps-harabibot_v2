import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  forEachCoordinateInRange,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";

interface UpgradeRoots {
  left?: RoomCoordinate;
  middle?: RoomCoordinate;
  right?: RoomCoordinate;
}

function findUpgradeRoots(
  terminalCoordinate: RoomCoordinate,
  controller: StructureController,
  upgradeTileIndices: Set<number>,
): UpgradeRoots | undefined {
  const dx = Math.sign(terminalCoordinate.x - controller.pos.x);
  const dy = Math.sign(terminalCoordinate.y - controller.pos.y);

  const startIndex = NEIGHBOR_OFFSETS.findIndex(
    (offset) => offset.x === dx && offset.y === dy,
  );

  const roots: RoomCoordinate[] = [];

  for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
    const offset = NEIGHBOR_OFFSETS[(startIndex + i) % 8];

    const coordinate = {
      x: terminalCoordinate.x + offset.x,
      y: terminalCoordinate.y + offset.y,
    };

    if (upgradeTileIndices.has(toRoomIndex(coordinate.x, coordinate.y))) {
      roots.push(coordinate);
    }
  }

  if (roots.length === 3) {
    return {
      left: roots[0],
      middle: roots[1],
      right: roots[2],
    };
  }

  if (roots.length === 2) {
    return {
      left: roots[0],
      right: roots[1],
    };
  }

  if (roots.length === 1) {
    return {
      left: roots[0],
    };
  }

  return undefined;
}

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
