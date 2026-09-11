import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { isInsideRoom, toRoomIndex } from "../../world/map/roomGrid";

import { ControllerAreaCandidate } from "./findControllerAreaCandidates";

export const CORE_STAMP = {
  storage: { x: 0, y: 0 },
  terminal: { x: 1, y: 1 },
  manager: { x: 1, y: 0 },
  spawn: { x: 2, y: 1 },
  link: { x: 2, y: -1 },
  linkFallback: { x: 2, y: 0 },
  roads: [
    { x: -1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
  ],
};

export interface CorePlan {
  manager: RoomCoordinate;
  terminal: RoomCoordinate;
  firstSpawn: RoomCoordinate;
  link: RoomCoordinate;
  roads: RoomCoordinate[];
}

export function findCorePlans(
  controllerAreaCandidate: ControllerAreaCandidate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): CorePlan[] {
  const { storage, upgradeChains } = controllerAreaCandidate;

  const upgradeTileIndices = new Set(
    Object.values(upgradeChains)
      .flat()
      .map(({ x, y }) => toRoomIndex(x, y)),
  );

  const coreCandidates: CorePlan[] = [];

  const middleRoot = upgradeChains.middle[0];

  for (const mirrored of [true, false]) {
    const corePlan = tryCoreStamp(
      storage,
      selectedRegionIds,
      regionByTile,
      upgradeTileIndices,
      middleRoot,
      mirrored,
    );

    if (!corePlan) {
      continue;
    }

    coreCandidates.push(corePlan);
  }

  return coreCandidates;
}

function isValidCoordinate(
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  upgradeTileIndices: Set<number>,
): boolean {
  if (!isInsideRoom(coordinate.x, coordinate.y)) {
    return false;
  }

  const index = toRoomIndex(coordinate.x, coordinate.y);

  if (!selectedRegionIds.has(regionByTile[index])) {
    return false;
  }

  if (upgradeTileIndices.has(index)) {
    return false;
  }

  return true;
}

function tryCoreStamp(
  storage: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  upgradeTileIndices: Set<number>,
  middleRoot: RoomCoordinate,
  mirrored: boolean,
): CorePlan | undefined {
  const forward = {
    x: middleRoot.x - storage.x,
    y: middleRoot.y - storage.y,
  };

  const transform = (coordinate: RoomCoordinate) =>
    transformCoreCoordinate(coordinate, storage, forward, mirrored);

  const isValid = (coordinate: RoomCoordinate) =>
    isValidCoordinate(
      coordinate,
      selectedRegionIds,
      regionByTile,
      upgradeTileIndices,
    );

  const manager = transform(CORE_STAMP.manager);

  if (!isValid(manager)) {
    return;
  }
  const terminal = transform(CORE_STAMP.terminal);

  if (!isValid(terminal)) {
    return;
  }

  const firstSpawn = transform(CORE_STAMP.spawn);

  if (!isValid(firstSpawn)) {
    return;
  }

  let link = transform(CORE_STAMP.link);

  if (!isValid(link)) {
    link = transform(CORE_STAMP.linkFallback);
    if (!isValid(link)) {
      return;
    }
  }

  const roads = CORE_STAMP.roads.map(transform);

  if (roads.some((road) => !isValid(road))) {
    return;
  }

  return {
    manager,
    terminal,
    firstSpawn,
    link,
    roads,
  };
}

function transformCoreCoordinate(
  coordinate: RoomCoordinate,
  anchor: RoomCoordinate,
  forward: RoomCoordinate,
  mirrored: boolean,
): RoomCoordinate {
  const localX = mirrored ? -coordinate.x : coordinate.x;

  const rightX = -forward.y;
  const rightY = forward.x;

  return {
    x: anchor.x + localX * rightX - coordinate.y * forward.x,
    y: anchor.y + localX * rightY - coordinate.y * forward.y,
  };
}
