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

const UPGRADE_TILES_TIER_ONE_THRESHOLD = 16;

const UPGRADE_TILES_TIER_TWO_THRESHOLD = 13;

const LEFT_TURN_ORDER = [-2, -1, 0, 1, 2, 3, 4, 5];
const RIGHT_TURN_ORDER = [2, 1, 0, -1, -2, -3, -4, -5];

interface UpgradeChains {
  left?: RoomCoordinate[];
  middle?: RoomCoordinate[];
  right?: RoomCoordinate[];
}

export interface ControllerAreaPlan {
  terminal: RoomCoordinate;
  upgradeChains: RoomCoordinate[][];
}

interface ControllerAreaCandidate {
  terminal: RoomCoordinate;
  upgradeChains: UpgradeChains;
  tier: number;
}

export function planControllerArea(
  controller: StructureController,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  selectedCenter: RoomCoordinate,
): ControllerAreaPlan | undefined {
  const terminalCandidates = findTerminalCandidates(
    controller,
    selectedRegionIds,
    regionByTile,
  );

  if (terminalCandidates.length === 0) {
    return;
  }

  const upgradeTiles = findUpgradeTiles(
    controller,
    selectedRegionIds,
    regionByTile,
  );

  const upgradeTileIndices = new Set(
    upgradeTiles.map(({ x, y }) => toRoomIndex(x, y)),
  );

  const controllerAreaCandidates: ControllerAreaCandidate[] = [];

  for (const terminalCoordinate of terminalCandidates) {
    const roots = findUpgradeRoots(
      terminalCoordinate,
      controller,
      upgradeTileIndices,
    );

    if (roots === undefined) {
      continue;
    }

    const upgradeChains = findUpgradeChains(
      roots,
      terminalCoordinate,
      upgradeTileIndices,
    );

    const compactChains = compactUpgradeChains(
      upgradeChains,
      roots,
      terminalCoordinate,
      upgradeTileIndices,
    );

    controllerAreaCandidates.push({
      terminal: terminalCoordinate,
      upgradeChains: compactChains,
      tier: getUpgradeCapacityTier(compactChains),
    });
  }

  controllerAreaCandidates.sort(
    (a, b) =>
      a.tier - b.tier ||
      getRange(selectedCenter, a.terminal) -
        getRange(selectedCenter, b.terminal),
  );

  const best = controllerAreaCandidates[0];

  if (!best) {
    return;
  }

  return {
    terminal: best.terminal,
    upgradeChains: Object.values(best.upgradeChains),
  };
}

function getUpgradeCapacityTier(upgradeChains: UpgradeChains): number {
  let numUpgradeTiles = 0;

  for (const chain of Object.values(upgradeChains)) {
    numUpgradeTiles += chain.length;
  }

  if (numUpgradeTiles >= UPGRADE_TILES_TIER_ONE_THRESHOLD) {
    return 1;
  }

  if (numUpgradeTiles >= UPGRADE_TILES_TIER_TWO_THRESHOLD) {
    return 2;
  }
  return 3;
}

function compactUpgradeChains(
  chains: UpgradeChains,
  roots: UpgradeRoots,
  terminalCoordinate: RoomCoordinate,
  upgradeTileIndices: Set<number>,
): UpgradeChains {
  let result: UpgradeChains = {
    left: [...(chains.left ?? [])],
    right: [...(chains.right ?? [])],
    middle: [...(chains.middle ?? [])],
  };

  for (const side of ["left", "right"] as const) {
    result = tryCompactOuterChain(
      result,
      side,
      roots,
      terminalCoordinate,
      upgradeTileIndices,
    );
  }

  return result;
}

function tryCompactOuterChain(
  chains: UpgradeChains,
  side: "left" | "right",
  roots: UpgradeRoots,
  terminalCoordinate: RoomCoordinate,
  upgradeTileIndices: Set<number>,
): UpgradeChains {
  if (roots[side] === undefined || chains[side] === undefined) {
    return chains;
  }

  const blockedTiles = [];

  for (const [currentSide, currentChain] of Object.entries(chains)) {
    if (currentSide !== side) {
      blockedTiles.push(...currentChain);
    }
  }

  const blockedTileIndices = new Set<number>(
    blockedTiles.map(({ x, y }) => toRoomIndex(x, y)),
  );

  const hand = side === "left" ? "right" : "left";

  const compactPath = followUpgradeWall(
    roots[side],
    terminalCoordinate,
    upgradeTileIndices,
    hand,
    6,
    blockedTileIndices,
  );

  if (compactPath.length >= chains[side].length) {
    chains[side] = compactPath;
    return chains;
  }

  return chains;
}

function findUpgradeChains(
  roots: UpgradeRoots,
  terminalCoordinate: RoomCoordinate,
  upgradeTileIndices: Set<number>,
): UpgradeChains {
  let blockedTileIndices = new Set(
    Object.values(roots).map((coordinate) =>
      toRoomIndex(coordinate.x, coordinate.y),
    ),
  );

  const leftMax = followUpgradeWall(
    roots.left,
    terminalCoordinate,
    upgradeTileIndices,
    "left",
    6,
    blockedTileIndices,
  );

  if (roots.right === undefined) {
    return { left: leftMax };
  }

  leftMax.forEach((coordinate) =>
    blockedTileIndices.add(toRoomIndex(coordinate.x, coordinate.y)),
  );

  const rightMax = followUpgradeWall(
    roots.right,
    terminalCoordinate,
    upgradeTileIndices,
    "right",
    6,
    blockedTileIndices,
  );

  if (roots.middle === undefined) {
    return { left: leftMax, right: rightMax };
  }

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

      blockedTileIndices = new Set(
        [...left, ...right].map((coordinate) =>
          toRoomIndex(coordinate.x, coordinate.y),
        ),
      );

      const middle: RoomCoordinate[] = findLongestUpgradePath(
        roots.middle,
        upgradeTileIndices,
        blockedTileIndices,
        6,
      );

      if (leftLength + rightLength + middle.length === 18) {
        return { left, right, middle };
      }

      middle.forEach((coordinate) =>
        blockedTileIndices.add(toRoomIndex(coordinate.x, coordinate.y)),
      );

      const paths = [left, right].sort((a, b) => a.length - b.length);

      for (const path of paths) {
        if (path.length === 6) {
          continue;
        }

        const remainingLength = 6 - path.length;
        const extendedPath = findLongestUpgradePath(
          path[path.length - 1],
          upgradeTileIndices,
          blockedTileIndices,
          remainingLength + 1,
        );

        if (extendedPath.length > 1) {
          path.push(...extendedPath.slice(1));

          extendedPath.forEach((coordinate) =>
            blockedTileIndices.add(toRoomIndex(coordinate.x, coordinate.y)),
          );
        }
      }

      const currentNumTiles = left.length + right.length + middle.length;

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

function followUpgradeWall(
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

function findUpgradeTiles(
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

function findTerminalCandidates(
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
