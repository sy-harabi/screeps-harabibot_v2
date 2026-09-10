import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";

export interface CorePlan {
  manager: RoomCoordinate;
  terminal: RoomCoordinate;
  link: RoomCoordinate;
  firstSpawn: RoomCoordinate;
  access: RoomCoordinate;
  accessRoads: RoomCoordinate[];
}

interface CoreCandidate extends CorePlan {
  accessTier: number;
}

export function planCore(
  controller: StructureController,
  storage: RoomCoordinate,
  upgradeChains: RoomCoordinate[][],
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  selectedCenter: RoomCoordinate,
): CorePlan | undefined {
  const roots = upgradeChains.map((chain) => chain[0]);
  const coreCandidates: CoreCandidate[] = [];

  for (const manager of findManagerCandidates(
    controller,
    storage,
    roots,
    selectedRegionIds,
    regionByTile,
  )) {
    coreCandidates.push(
      ...findCoreCandidatesForManager(
        controller,
        storage,
        manager,
        selectedRegionIds,
        regionByTile,
        selectedCenter,
      ),
    );
  }

  coreCandidates.sort(
    (a, b) =>
      a.accessTier - b.accessTier ||
      getRange(a.access, selectedCenter) - getRange(b.access, selectedCenter),
  );

  return coreCandidates[0];
}

function findCoreCandidatesForManager(
  controller: StructureController,
  storage: RoomCoordinate,
  manager: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  selectedCenter: RoomCoordinate,
): CoreCandidate[] {
  const candidates: CoreCandidate[] = [];

  for (const terminal of findAdjacentCoreTiles(
    controller,
    manager,
    selectedRegionIds,
    regionByTile,
    [storage, manager],
  )) {
    for (const link of findAdjacentCoreTiles(
      controller,
      manager,
      selectedRegionIds,
      regionByTile,
      [storage, manager, terminal],
    )) {
      for (const firstSpawn of findAdjacentCoreTiles(
        controller,
        manager,
        selectedRegionIds,
        regionByTile,
        [storage, manager, terminal, link],
      )) {
        const accessRoads = findCoreAccessRoads(
          terminal,
          storage,
          selectedRegionIds,
          regionByTile,
          [storage, manager, terminal, link, firstSpawn],
        );

        if (accessRoads.length === 0) {
          continue;
        }

        accessRoads.sort(
          (a, b) => getRange(a, selectedCenter) - getRange(b, selectedCenter),
        );

        candidates.push({
          manager,
          terminal,
          link,
          firstSpawn,
          access: accessRoads[0],
          accessRoads,
          accessTier: getAccessTier(accessRoads.length),
        });
      }
    }
  }

  return candidates;
}

function findManagerCandidates(
  controller: StructureController,
  storage: RoomCoordinate,
  roots: RoomCoordinate[],
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): RoomCoordinate[] {
  const candidates: RoomCoordinate[] = [];

  for (const manager of getNeighbors(storage)) {
    if (
      !isValidCoreTile(
        controller,
        manager,
        selectedRegionIds,
        regionByTile,
      )
    ) {
      continue;
    }

    if (!roots.some((root) => getRange(root, manager) === 1)) {
      continue;
    }

    candidates.push(manager);
  }

  return candidates;
}

function findAdjacentCoreTiles(
  controller: StructureController,
  origin: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  blockedCoordinates: readonly RoomCoordinate[],
): RoomCoordinate[] {
  const blockedTileIndices = toIndexSet(blockedCoordinates);
  const candidates: RoomCoordinate[] = [];

  for (const coordinate of getNeighbors(origin)) {
    if (
      isValidCoreTile(
        controller,
        coordinate,
        selectedRegionIds,
        regionByTile,
        blockedTileIndices,
      )
    ) {
      candidates.push(coordinate);
    }
  }

  return candidates;
}

function findCoreAccessRoads(
  terminal: RoomCoordinate,
  storage: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  blockedCoordinates: readonly RoomCoordinate[],
): RoomCoordinate[] {
  const blockedTileIndices = toIndexSet(blockedCoordinates);
  const roads: RoomCoordinate[] = [];

  for (const coordinate of getNeighbors(storage)) {
    if (getRange(coordinate, terminal) > 1) {
      continue;
    }

    if (
      !isValidRoadTile(
        coordinate,
        selectedRegionIds,
        regionByTile,
        blockedTileIndices,
      )
    ) {
      continue;
    }

    roads.push(coordinate);
  }

  return roads;
}

function isValidCoreTile(
  controller: StructureController,
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  blockedTileIndices?: Set<number>,
): boolean {
  if (!isValidSelectedRegionTile(coordinate, selectedRegionIds, regionByTile)) {
    return false;
  }

  if (getRange(controller.pos, coordinate) <= 3) {
    return false;
  }

  return !blockedTileIndices?.has(toRoomIndex(coordinate.x, coordinate.y));
}

function isValidRoadTile(
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  blockedTileIndices: Set<number>,
): boolean {
  if (!isValidSelectedRegionTile(coordinate, selectedRegionIds, regionByTile)) {
    return false;
  }

  return !blockedTileIndices.has(toRoomIndex(coordinate.x, coordinate.y));
}

function isValidSelectedRegionTile(
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): boolean {
  if (!isInsideRoom(coordinate.x, coordinate.y)) {
    return false;
  }

  return selectedRegionIds.has(
    regionByTile[toRoomIndex(coordinate.x, coordinate.y)],
  );
}

function getNeighbors(coordinate: RoomCoordinate): RoomCoordinate[] {
  return NEIGHBOR_OFFSETS.map((offset) => ({
    x: coordinate.x + offset.x,
    y: coordinate.y + offset.y,
  }));
}

function toIndexSet(coordinates: readonly RoomCoordinate[]): Set<number> {
  return new Set(
    coordinates.map(({ x, y }) => toRoomIndex(x, y)),
  );
}

function getAccessTier(numAccessRoads: number): number {
  if (numAccessRoads >= 3) {
    return 1;
  }

  if (numAccessRoads === 2) {
    return 2;
  }

  return 3;
}
