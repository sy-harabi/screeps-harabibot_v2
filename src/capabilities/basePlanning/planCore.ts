import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { UpgradeChains } from "./findControllerAreaCandidates";

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
  access: RoomCoordinate;
  accessRoads: RoomCoordinate[];
}

interface CoreCandidate extends CorePlan {
  accessTier: number;
}

export function planCore(
  controller: StructureController,
  storage: RoomCoordinate,
  upgradeChains: UpgradeChains,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  selectedCenter: RoomCoordinate,
): CorePlan | undefined {
  const terminal = {
    x: storage.x + CORE_STAMP.terminal.x,
    y: storage.y + CORE_STAMP.terminal.y,
  };

  const manager = {
    x: storage.x + CORE_STAMP.manager.x,
    y: storage.y + CORE_STAMP.manager.y,
  };

  const roots = Object.values(upgradeChains).map((chain) => chain[0]);

  const coreCandidates: CoreCandidate[] = [];

  return coreCandidates[0];
}
