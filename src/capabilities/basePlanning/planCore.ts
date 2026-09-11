import { RoomCoordinate } from "../../world/map/roomCoordinate";
import { isInsideRoom, toRoomIndex } from "../../world/map/roomGrid";

import {
  ControllerAreaCandidate,
  UpgradeChains,
} from "./findControllerAreaCandidates";

export const CORE_STAMP = {
  storage: { x: 0, y: 0 },
  terminal: { x: 1, y: 1 },
  manager: { x: 1, y: 0 },
  spawn: { x: 2, y: 1 },
  link: { x: 2, y: -1 },
  roads: [
    { x: -2, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
    { x: 2, y: 0 },
  ],
};

export interface CorePlan {
  manager: RoomCoordinate;
  terminal: RoomCoordinate;
  link: RoomCoordinate;
  firstSpawn: RoomCoordinate;
  roads: RoomCoordinate[];
}

export function findCorePlans(
  controllerAreaCandidate: ControllerAreaCandidate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): CorePlan[] {
  const { storage, upgradeChains } = controllerAreaCandidate;

  const middleRoot = upgradeChains.middle[0];

  const coreCandidates: CorePlan[] = [];

  for (const mirrored of [true, false]) {
    const corePlan = applyCoreStamp(storage, middleRoot, mirrored);

    if (!isValidCorePlan(corePlan, selectedRegionIds, regionByTile)) {
      continue;
    }

    coreCandidates.push(corePlan);
  }

  return coreCandidates;
}

function isValidCorePlan(
  corePlan: CorePlan,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
) {
  const isValid = (coordinate: RoomCoordinate) =>
    isValidCoordinate(coordinate, selectedRegionIds, regionByTile);

  return (
    isValid(corePlan.firstSpawn) &&
    isValid(corePlan.link) &&
    isValid(corePlan.manager) &&
    isValid(corePlan.terminal) &&
    corePlan.roads.every((coordinate) => isValid(coordinate))
  );
}

function isValidCoordinate(
  coordinate: RoomCoordinate,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): boolean {
  if (!isInsideRoom(coordinate.x, coordinate.y)) {
    return false;
  }

  const index = toRoomIndex(coordinate.x, coordinate.y);

  if (!selectedRegionIds.has(regionByTile[index])) {
    return false;
  }

  return true;
}

function applyCoreStamp(
  storage: RoomCoordinate,
  middleRoot: RoomCoordinate,
  mirrored: boolean,
): CorePlan {
  const forward = {
    x: middleRoot.x - storage.x,
    y: middleRoot.y - storage.y,
  };

  const transform = (coordinate: RoomCoordinate) =>
    transformCoreCoordinate(coordinate, storage, forward, mirrored);

  return {
    manager: transform(CORE_STAMP.manager),
    terminal: transform(CORE_STAMP.terminal),
    link: transform(CORE_STAMP.link),
    firstSpawn: transform(CORE_STAMP.spawn),
    roads: CORE_STAMP.roads.map(transform),
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
