import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";

export interface CorePlan {
  manager: RoomCoordinate;
  storage: RoomCoordinate;
  link: RoomCoordinate;
  access: RoomCoordinate;
  accessRoads: RoomCoordinate[];
}

export function planCore(
  controller: StructureController,
  terminal: RoomCoordinate,
  upgradeChains: RoomCoordinate[][],
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  selectedCenter: RoomCoordinate,
): CorePlan | undefined {
  const roots = upgradeChains.map((chain) => chain[0]);

  const coreCandidates = [];

  function isValidTile(
    { x, y }: RoomCoordinate,
    blockedTileIndices?: Set<number>,
  ): boolean {
    if (!isInsideRoom(x, y)) {
      return false;
    }

    if (getRange(controller.pos, { x, y }) <= 3) {
      return false;
    }

    const index = toRoomIndex(x, y);

    if (!selectedRegionIds.has(regionByTile[index])) {
      return false;
    }

    if (blockedTileIndices && blockedTileIndices.has(index)) {
      return false;
    }

    return true;
  }

  // manager loop
  for (const offset of NEIGHBOR_OFFSETS) {
    const managerCandidate = {
      x: terminal.x + offset.x,
      y: terminal.y + offset.y,
    };

    if (!isValidTile(managerCandidate)) {
      continue;
    }

    if (!roots.some((root) => getRange(root, managerCandidate) === 1)) {
      continue;
    }

    // storage loop
    for (const offset of NEIGHBOR_OFFSETS) {
      const blockedTileIndices = new Set<number>(
        [terminal, managerCandidate].map(({ x, y }) => toRoomIndex(x, y)),
      );

      const storageCandidate = {
        x: managerCandidate.x + offset.x,
        y: managerCandidate.y + offset.y,
      };

      if (!isValidTile(storageCandidate, blockedTileIndices)) {
        continue;
      }

      const coreAccessRoads = [];

      for (const offset of NEIGHBOR_OFFSETS) {
        const blockedTileIndices = new Set<number>(
          [terminal, managerCandidate, storageCandidate].map(({ x, y }) =>
            toRoomIndex(x, y),
          ),
        );

        const linkCandidate = {
          x: storageCandidate.x + offset.x,
          y: storageCandidate.y + offset.y,
        };

        if (!isValidTile(linkCandidate, blockedTileIndices)) {
          continue;
        }

        // access loop
        for (const offset of NEIGHBOR_OFFSETS) {
          const blockedTileIndices = new Set<number>(
            [terminal, managerCandidate, storageCandidate, linkCandidate].map(
              ({ x, y }) => toRoomIndex(x, y),
            ),
          );

          const accessCandidate = {
            x: storageCandidate.x + offset.x,
            y: storageCandidate.y + offset.y,
          };

          if (!isValidTile(accessCandidate, blockedTileIndices)) {
            continue;
          }

          if (getRange(accessCandidate, terminal) > 1) {
            continue;
          }

          coreAccessRoads.push(accessCandidate);
        }

        if (coreAccessRoads.length === 0) {
          continue;
        }

        coreAccessRoads.sort(
          (a, b) => getRange(a, selectedCenter) - getRange(b, selectedCenter),
        );

        const access = coreAccessRoads[0];

        coreCandidates.push({
          manager: managerCandidate,
          storage: storageCandidate,
          link: linkCandidate,
          access,
          accessRoads: coreAccessRoads,
          accessTier: Math.max(1, 4 - coreAccessRoads.length),
        });
      }
    }
  }

  if (coreCandidates.length === 0) {
    return;
  }

  coreCandidates.sort((a, b) => {
    return (
      a.accessTier - b.accessTier ||
      getRange(a.access, selectedCenter) - getRange(b.access, selectedCenter)
    );
  });

  return coreCandidates[0];
}
