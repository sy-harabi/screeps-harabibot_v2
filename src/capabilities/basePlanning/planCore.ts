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

  // manager loop
  for (const managerCandidate of findManagerCandidates(
    controller,
    selectedRegionIds,
    regionByTile,
    terminal,
    roots,
  )) {
    // storage loop
    for (const storageCandidate of findStorageCandidates(
      controller,
      managerCandidate,
      selectedRegionIds,
      regionByTile,
      terminal,
    )) {
      // link loop
      for (const offset of NEIGHBOR_OFFSETS) {
        const blockedTileIndices = new Set<number>(
          [terminal, managerCandidate, storageCandidate].map(({ x, y }) =>
            toRoomIndex(x, y),
          ),
        );

        const linkCandidate = {
          x: managerCandidate.x + offset.x,
          y: managerCandidate.y + offset.y,
        };

        if (
          !isValidTile(
            controller,
            linkCandidate,
            selectedRegionIds,
            regionByTile,
            blockedTileIndices,
          )
        ) {
          continue;
        }

        const coreAccessRoads = [];

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

          if (
            !isValidTile(
              controller,
              accessCandidate,
              selectedRegionIds,
              regionByTile,
              blockedTileIndices,
            )
          ) {
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
function findLinkCandidates(
  controller: StructureController,
  managerCandidate: RoomCoordinate,
  storageCandidate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  terminal: RoomCoordinate,
): RoomCoordinate[] {
  const storageCandidates = [];

  const blockedTileIndices = new Set<number>(
    [terminal, managerCandidate].map(({ x, y }) => toRoomIndex(x, y)),
  );

  for (const offset of NEIGHBOR_OFFSETS) {
    const storageCandidate = {
      x: terminal.x + offset.x,
      y: terminal.y + offset.y,
    };

    if (
      !isValidTile(
        controller,
        storageCandidate,
        selectedRegionIds,
        regionByTile,
        blockedTileIndices,
      )
    ) {
      continue;
    }

    storageCandidates.push(storageCandidate);
  }

  return storageCandidates;
}

function findStorageCandidates(
  controller: StructureController,
  managerCandidate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  terminal: RoomCoordinate,
): RoomCoordinate[] {
  const storageCandidates = [];

  const blockedTileIndices = new Set<number>(
    [terminal, managerCandidate].map(({ x, y }) => toRoomIndex(x, y)),
  );

  for (const offset of NEIGHBOR_OFFSETS) {
    const storageCandidate = {
      x: terminal.x + offset.x,
      y: terminal.y + offset.y,
    };

    if (
      !isValidTile(
        controller,
        storageCandidate,
        selectedRegionIds,
        regionByTile,
        blockedTileIndices,
      )
    ) {
      continue;
    }

    storageCandidates.push(storageCandidate);
  }

  return storageCandidates;
}

function findManagerCandidates(
  controller: StructureController,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  terminal: RoomCoordinate,
  roots: RoomCoordinate[],
): RoomCoordinate[] {
  const managerCandidates = [];

  for (const offset of NEIGHBOR_OFFSETS) {
    const managerCandidate = {
      x: terminal.x + offset.x,
      y: terminal.y + offset.y,
    };

    if (
      !isValidTile(
        controller,
        managerCandidate,
        selectedRegionIds,
        regionByTile,
      )
    ) {
      continue;
    }

    if (!roots.some((root) => getRange(root, managerCandidate) === 1)) {
      continue;
    }

    managerCandidates.push(managerCandidate);
  }

  return managerCandidates;
}

function isValidTile(
  controller: StructureController,
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  blockedTileIndices?: Set<number>,
): boolean {
  if (!isInsideRoom(coordinate.x, coordinate.y)) {
    return false;
  }

  if (getRange(controller.pos, coordinate) <= 3) {
    return false;
  }

  const index = toRoomIndex(coordinate.x, coordinate.y);

  if (!selectedRegionIds.has(regionByTile[index])) {
    return false;
  }

  if (blockedTileIndices && blockedTileIndices.has(index)) {
    return false;
  }

  return true;
}
