import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
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
  linkFallback: { x: 2, y: 0 },
  parking: [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ],
  parkingOptional: { x: -1, y: 0 },
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
  factory: RoomCoordinate;
  powerSpawn: RoomCoordinate;
  parking: RoomCoordinate[];
  roads: RoomCoordinate[];
}

export function findCorePlans(
  controllerAreaCandidate: ControllerAreaCandidate,
  planningMask: Uint8Array,
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
      planningMask,
      upgradeTileIndices,
      upgradeChains,
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
  planningMask: Uint8Array,
  upgradeTileIndices: Set<number>,
): boolean {
  if (!isInsideRoom(coordinate.x, coordinate.y)) {
    return false;
  }

  const index = toRoomIndex(coordinate.x, coordinate.y);

  if (!planningMask[index]) {
    return false;
  }

  if (upgradeTileIndices.has(index)) {
    return false;
  }

  return true;
}

function tryCoreStamp(
  storage: RoomCoordinate,
  planningMask: Uint8Array,
  upgradeTileIndices: Set<number>,
  upgradeChains: UpgradeChains,
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
    isValidCoordinate(coordinate, planningMask, upgradeTileIndices);

  const manager = transform(CORE_STAMP.manager);

  if (!isValid(manager)) {
    return;
  }

  const managerStructures = findManagerStructures(manager, upgradeChains);

  if (!managerStructures) {
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

  const parking = CORE_STAMP.parking.map(transform);

  if (parking.some((coordinate) => !isValid(coordinate))) {
    return;
  }

  const optionalParking = transform(CORE_STAMP.parkingOptional);

  if (isValid(optionalParking)) {
    parking.push(optionalParking);
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
    ...managerStructures,
    parking,
    roads,
  };
}

function findManagerStructures(
  manager: RoomCoordinate,
  upgradeChains: UpgradeChains,
): Pick<CorePlan, "factory" | "powerSpawn"> | undefined {
  const adjacentChains = Object.values(upgradeChains)
    .filter(
      (chain) => chain.length > 0 && getRange(manager, chain[0]) === 1,
    )
    .sort((left, right) => left.length - right.length);

  if (adjacentChains.length < 2) {
    return;
  }

  return {
    factory: adjacentChains[0][0],
    powerSpawn: adjacentChains[adjacentChains.length - 1][0],
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
