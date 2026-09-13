import { dijkstraMap } from "../../world/map/dijkstraMap";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";
import { LabPlan } from "./planLabs";
import { RegionBoundaryRoadPlan } from "./planRegionBoundaryRoads";
import { ResourceTreePlan } from "./planResourceTree";

export interface StructureSlot {
  readonly coordinate: RoomCoordinate;
  readonly growthDistance: number;
}

export interface StructureSlotPlan {
  readonly slots: StructureSlot[];
  readonly roads: RoomCoordinate[];
}

export function planStructureSlots(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  visual: RoomVisual,
): StructureSlotPlan | undefined {
  const roadMask = buildRoadMask(
    corePlan,
    resourceTree,
    boundaryRoadPlan,
    labPlan,
  );

  const blockedMask = buildStructureSlotBlockedMask(
    controllerArea,
    corePlan,
    resourceTree,
    boundaryRoadPlan,
    labPlan,
  );

  const growthDistanceMap = buildGrowthDistanceMap(
    terrain,
    selectedRegionIds,
    regionByTile,
    corePlan,
    roadMask,
    blockedMask,
  );

  const slots = collectStructureSlots(
    terrain,
    roadMask,
    blockedMask,
    growthDistanceMap,
    selectedRegionIds,
    regionByTile,
  );

  slots.sort(
    (a, b) =>
      a.growthDistance - b.growthDistance ||
      toRoomIndex(a.coordinate.x, a.coordinate.y) -
        toRoomIndex(b.coordinate.x, b.coordinate.y),
  );

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    visual.text(
      slot.growthDistance.toString(),
      slot.coordinate.x,
      slot.coordinate.y,
    );
  }

  return;
}

function collectStructureSlots(
  terrain: RoomTerrain,
  roadMask: Uint8Array,
  structureBlockedMask: Uint8Array,
  growthDistanceMap: Int32Array,
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
): StructureSlot[] {
  const slotMask = new Uint8Array(ROOM_AREA);
  const slots: StructureSlot[] = [];

  for (let roadIndex = 0; roadIndex < ROOM_AREA; roadIndex++) {
    if (!roadMask[roadIndex]) {
      continue;
    }

    const road = fromRoomIndex(roadIndex);

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = road.x + offset.x;
      const y = road.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const index = toRoomIndex(x, y);

      if (slotMask[index]) {
        continue;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      if (roadMask[index]) {
        continue;
      }

      if (structureBlockedMask[index]) {
        continue;
      }

      if (!selectedRegionIds.has(regionByTile[index])) {
        continue;
      }

      const growthDistance = growthDistanceMap[index];

      if (growthDistance < 0) {
        continue;
      }

      slotMask[index] = 1;

      slots.push({
        coordinate: { x, y },
        growthDistance,
      });
    }
  }

  return slots;
}

function buildGrowthDistanceMap(
  terrain: RoomTerrain,
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  corePlan: CorePlan,
  roadMask: Uint8Array,
  blockedMask: Uint8Array,
) {
  const getGrowthCost = (x: number, y: number, terrainType: number): number => {
    const index = toRoomIndex(x, y);

    if (roadMask[index]) {
      return 4;
    }

    return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
  };

  return dijkstraMap(terrain, corePlan.roads, getGrowthCost, (x, y) => {
    const index = toRoomIndex(x, y);

    return selectedRegionIds.has(regionByTile[index]) && !blockedMask[index];
  });
}

function buildRoadMask(
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA);

  function mask(coordinate: RoomCoordinate) {
    const index = toRoomIndex(coordinate.x, coordinate.y);
    roadMask[index] = 1;
  }

  corePlan.roads.forEach(mask);

  resourceTree.roads.forEach(mask);

  boundaryRoadPlan.roads.forEach(mask);

  labPlan.serviceRoads.forEach(mask);

  return roadMask;
}

function buildStructureSlotBlockedMask(
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
): Uint8Array {
  const blockedMask = new Uint8Array(ROOM_AREA);

  function block(coordinate: RoomCoordinate) {
    const index = toRoomIndex(coordinate.x, coordinate.y);
    blockedMask[index] = 1;
  }

  block(controllerArea.storage);

  const { left, right, middle } = controllerArea.upgradeChains;

  for (const chain of [left, right, middle]) {
    chain.forEach(block);
  }

  block(corePlan.manager);
  block(corePlan.firstSpawn);
  block(corePlan.link);
  block(corePlan.powerSpawn);
  block(corePlan.terminal);

  corePlan.parking.forEach(block);

  resourceTree.branches.forEach((branch) => {
    block(branch.container);
    if (branch.link) {
      block(branch.link);
    }
  });

  labPlan.inputLabs.forEach(block);

  labPlan.outputLabs.forEach(block);

  return blockedMask;
}
