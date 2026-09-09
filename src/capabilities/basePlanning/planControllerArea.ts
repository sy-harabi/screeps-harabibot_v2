import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  forEachCoordinateInRange,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";

interface UpgradeRoots {
  left: RoomCoordinate;
  middle?: RoomCoordinate;
  right?: RoomCoordinate;
}

const LEFT_TURN_ORDER = [-2, -1, 0, 1, 2, 3, 4, 5];
const RIGHT_TURN_ORDER = [2, 1, 0, -1, -2, -3, -4, -5];

interface UpgradeChains {
  left?: RoomCoordinate[];
  middle?: RoomCoordinate[];
  right?: RoomCoordinate[];
}

export function findUpgradeChains(
  roots: UpgradeRoots,
  terminalCoordinate: RoomCoordinate,
  upgradeTileIndices: Set<number>,
): UpgradeChains | undefined {
  const blockedTileIndices = new Set<number>();

  const leftMax = followUpgradeWall(
    roots.left,
    terminalCoordinate,
    upgradeTileIndices,
    "left",
    6,
  );

  if (roots.right === undefined) {
    return { left: leftMax };
  }

  leftMax.forEach((coordinate) =>
    blockedTileIndices.add(toRoomIndex(coordinate.x, coordinate.y)),
  );

  const rightMax = followUpgradeWall(
    roots.right || roots.middle,
    terminalCoordinate,
    upgradeTileIndices,
    "right",
    6,
    blockedTileIndices,
  );

  if (roots.middle === undefined) {
    return { left: leftMax, right: rightMax };
  }

  rightMax.forEach((coordinate) =>
    blockedTileIndices.add(toRoomIndex(coordinate.x, coordinate.y)),
  );

  let best = {
    left: leftMax,
    right: rightMax,
    middle: [roots.middle],
  };

  let bestNumTiles = leftMax.length + rightMax.length + 1;

  for (let leftLength = leftMax.length; leftLength >= 1; leftLength--) {
    for (let rightLength = rightMax.length; rightLength >= 1; rightLength--) {
      const left = leftMax.slice(0, leftLength);
      const right = rightMax.slice(0, rightLength);
      const middle: RoomCoordinate[] = findLongestUpgradePath(
        roots.middle,
        upgradeTileIndices,
        blockedTileIndices,
        6,
      );

      const currentNumTiles = leftLength + rightLength + middle.length;

      if (currentNumTiles === 18) {
        return { left, right, middle };
      }

      if (currentNumTiles > bestNumTiles) {
        best = { left, right, middle };
        bestNumTiles = currentNumTiles;
      }
    }
  }

  return best;
}

function findLongestUpgradePath(
  root: RoomCoordinate,
  upgradeTileIndices: Set<number>,
  blockedTileIndices: Set<number>,
  maxLength = 6,
): RoomCoordinate[] {
  const path: RoomCoordinate[] = [root];
  let bestPath: RoomCoordinate[] = [root];

  const visited = new Set<number>([toRoomIndex(root.x, root.y)]);

  function dfs(current: RoomCoordinate): boolean {
    if (path.length > bestPath.length) {
      bestPath = [...path];
    }

    if (path.length === maxLength) {
      return true;
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const next = {
        x: current.x + offset.x,
        y: current.y + offset.y,
      };

      if (!isInsideRoom(next.x, next.y)) {
        continue;
      }

      const nextIndex = toRoomIndex(next.x, next.y);

      if (
        !upgradeTileIndices.has(nextIndex) ||
        blockedTileIndices.has(nextIndex) ||
        visited.has(nextIndex)
      ) {
        continue;
      }

      visited.add(nextIndex);
      path.push(next);

      if (dfs(next)) {
        return true;
      }

      path.pop();
      visited.delete(nextIndex);
    }

    return false;
  }

  dfs(root);

  return bestPath;
}
export function followUpgradeWall(
  root: RoomCoordinate,
  terminalCoordinate: RoomCoordinate,
  upgradeTileIndices: Set<number>,
  hand: "left" | "right",
  maxLength = 6,
  blockedTileIndices?: Set<number>,
): RoomCoordinate[] {
  const path: RoomCoordinate[] = [root];
  const visited = new Set<number>([toRoomIndex(root.x, root.y)]);

  let current = root;
  let heading = NEIGHBOR_OFFSETS.findIndex(
    (offset) =>
      offset.x === Math.sign(root.x - terminalCoordinate.x) &&
      offset.y === Math.sign(root.y - terminalCoordinate.y),
  );

  const order = hand === "left" ? LEFT_TURN_ORDER : RIGHT_TURN_ORDER;

  while (path.length < maxLength) {
    let moved = false;

    for (const turn of order) {
      const direction = (heading + turn + 8) % 8;
      const offset = NEIGHBOR_OFFSETS[direction];
      const next = { x: current.x + offset.x, y: current.y + offset.y };

      if (!isInsideRoom(next.x, next.y)) {
        continue;
      }

      const nextIndex = toRoomIndex(next.x, next.y);
      if (
        !upgradeTileIndices.has(nextIndex) ||
        visited.has(nextIndex) ||
        blockedTileIndices?.has(nextIndex)
      ) {
        continue;
      }

      current = next;
      heading = direction;
      path.push(next);
      visited.add(nextIndex);
      moved = true;
      break;
    }

    if (!moved) {
      break;
    }
  }

  return path;
}

export function findUpgradeRoots(
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
