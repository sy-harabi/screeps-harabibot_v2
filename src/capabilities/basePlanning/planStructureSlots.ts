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

const REQUIRED_STRUCTURE_SLOTS = 70;

const DIAGONAL_DIRECTIONS: readonly RoomCoordinate[] = [
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

interface BranchCandidate {
  readonly newRoadIndices: number[];
}

export interface StructureSlot {
  readonly coordinate: RoomCoordinate;
  readonly serviceDistance: number;
}

export interface StructureSlotPlan {
  readonly slots: StructureSlot[];
  readonly roads: RoomCoordinate[];
  readonly complete: boolean;
}

export function planStructureSlots(
  terrain: RoomTerrain,
  planningMask: Uint8Array,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  visual: RoomVisual,
): StructureSlotPlan | undefined {
  const mandatoryRoadMask = buildRoadMask(
    corePlan,
    resourceTree,
    boundaryRoadPlan,
    labPlan,
  );

  const blockedMask = buildStructureSlotBlockedMask(
    controllerArea,
    corePlan,
    resourceTree,
    labPlan,
  );

  const serviceDistanceMap = buildServiceDistanceMap(
    terrain,
    planningMask,
    corePlan,
    blockedMask,
  );

  const serviceDistances = collectServiceDistances(serviceDistanceMap);

  let plan: StructureSlotPlan | undefined;

  for (const maxServiceDistance of [...serviceDistances]) {
    plan = findGreedySlotPlan(
      terrain,
      mandatoryRoadMask,
      blockedMask,
      serviceDistanceMap,
      maxServiceDistance,
      planningMask,
    );

    if (plan && plan.complete) {
      break;
    }
  }

  if (!plan) {
    return;
  }

  visualizeStructureSlotPlan(plan, visual);

  return plan;
}

function findGreedySlotPlan(
  terrain: RoomTerrain,
  mandatoryRoadMask: Uint8Array,
  blockedMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
  planningMask: Uint8Array,
): StructureSlotPlan | undefined {
  const serviceRoadMask = buildActiveRoadMask(
    mandatoryRoadMask,
    serviceDistanceMap,
    maxServiceDistance,
  );
  const addedRoadMask = new Uint8Array(ROOM_AREA);

  let slots = collectStructureSlots(
    terrain,
    serviceRoadMask,
    mandatoryRoadMask,
    blockedMask,
    planningMask,
    serviceDistanceMap,
  );

  let complete = true;

  while (slots.length < REQUIRED_STRUCTURE_SLOTS) {
    const candidates = generateBranchCandidates(
      serviceRoadMask,
      serviceDistanceMap,
      maxServiceDistance,
    );

    let bestCandidate: BranchCandidate | undefined;
    let bestSlots: StructureSlot[] | undefined;
    let bestGain = 0;
    let bestCost = Infinity;

    for (const candidate of candidates) {
      const candidateRoadMask = serviceRoadMask.slice();

      for (const index of candidate.newRoadIndices) {
        candidateRoadMask[index] = 1;
      }

      const candidateSlots = collectStructureSlots(
        terrain,
        candidateRoadMask,
        mandatoryRoadMask,
        blockedMask,
        planningMask,
        serviceDistanceMap,
      );
      const gain = candidateSlots.length - slots.length;
      const cost = candidate.newRoadIndices.length;

      if (gain <= 0) {
        continue;
      }

      if (
        bestCandidate &&
        (gain * bestCost < bestGain * cost ||
          (gain * bestCost === bestGain * cost &&
            (gain < bestGain || (gain === bestGain && cost >= bestCost))))
      ) {
        continue;
      }

      bestCandidate = candidate;
      bestSlots = candidateSlots;
      bestGain = gain;
      bestCost = cost;
    }

    if (!bestCandidate || !bestSlots) {
      complete = false;
      break;
    }

    for (const index of bestCandidate.newRoadIndices) {
      serviceRoadMask[index] = 1;
      addedRoadMask[index] = 1;
    }

    slots = bestSlots;
  }

  return {
    slots,
    roads: collectCoordinates(addedRoadMask),
    complete,
  };
}

function generateBranchCandidates(
  serviceRoadMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
): BranchCandidate[] {
  const candidates: BranchCandidate[] = [];
  const seen = new Set<string>();

  for (let rootIndex = 0; rootIndex < ROOM_AREA; rootIndex++) {
    if (!serviceRoadMask[rootIndex]) {
      continue;
    }

    const root = fromRoomIndex(rootIndex);

    for (const direction of DIAGONAL_DIRECTIONS) {
      const newRoadIndices: number[] = [];

      for (let step = 1; step <= 3; step++) {
        const x = root.x + direction.x * step;
        const y = root.y + direction.y * step;

        if (!isInsideRoom(x, y)) {
          break;
        }

        const index = toRoomIndex(x, y);
        const serviceDistance = serviceDistanceMap[index];

        if (serviceDistance < 0 || serviceDistance > maxServiceDistance) {
          break;
        }

        if (!serviceRoadMask[index]) {
          newRoadIndices.push(index);
        }
      }

      if (newRoadIndices.length < 2) {
        continue;
      }

      newRoadIndices.sort((left, right) => left - right);
      const key = newRoadIndices.join(",");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({ newRoadIndices });
    }
  }

  return candidates;
}

function collectStructureSlots(
  terrain: RoomTerrain,
  serviceRoadMask: Uint8Array,
  mandatoryRoadMask: Uint8Array,
  structureBlockedMask: Uint8Array,
  planningMask: Uint8Array,
  serviceDistanceMap: Int32Array,
): StructureSlot[] {
  const slotMask = new Uint8Array(ROOM_AREA);
  const slots: StructureSlot[] = [];

  for (let roadIndex = 0; roadIndex < ROOM_AREA; roadIndex++) {
    if (!serviceRoadMask[roadIndex]) {
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

      if (serviceRoadMask[index] || mandatoryRoadMask[index]) {
        continue;
      }

      if (structureBlockedMask[index]) {
        continue;
      }

      if (!planningMask[index]) {
        continue;
      }

      const serviceDistance = serviceDistanceMap[index];

      if (serviceDistance < 0) {
        continue;
      }

      slotMask[index] = 1;
      slots.push({ coordinate: { x, y }, serviceDistance });
    }
  }

  return slots;
}

function buildServiceDistanceMap(
  terrain: RoomTerrain,
  planningMask: Uint8Array,
  corePlan: CorePlan,
  blockedMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    corePlan.roads,
    (_x, _y, terrainType) => (terrainType === TERRAIN_MASK_SWAMP ? 6 : 5),
    (x, y) => {
      const index = toRoomIndex(x, y);

      return planningMask[index] === 1 && !blockedMask[index];
    },
  );
}

function collectServiceDistances(serviceDistanceMap: Int32Array): number[] {
  const distances = new Set<number>();

  for (const distance of serviceDistanceMap) {
    if (distance >= 0) {
      distances.add(distance);
    }
  }

  return [...distances].sort((left, right) => left - right);
}

function buildActiveRoadMask(
  mandatoryRoadMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
): Uint8Array {
  const activeRoadMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!mandatoryRoadMask[index]) {
      continue;
    }

    const serviceDistance = serviceDistanceMap[index];

    if (serviceDistance < 0 || serviceDistance > maxServiceDistance) {
      continue;
    }

    activeRoadMask[index] = 1;
  }

  return activeRoadMask;
}

function collectCoordinates(mask: Uint8Array): RoomCoordinate[] {
  const coordinates: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (mask[index]) {
      coordinates.push(fromRoomIndex(index));
    }
  }

  return coordinates;
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
  labPlan: LabPlan,
): Uint8Array {
  const blockedMask = new Uint8Array(ROOM_AREA);

  function block(coordinate: RoomCoordinate) {
    const index = toRoomIndex(coordinate.x, coordinate.y);
    blockedMask[index] = 1;
  }

  block(controllerArea.storage);

  const managerStructureIndices = new Set([
    toRoomIndex(corePlan.factory.x, corePlan.factory.y),
    toRoomIndex(corePlan.powerSpawn.x, corePlan.powerSpawn.y),
  ]);

  const { left, middle, right } = controllerArea.upgradeChains;

  for (const chain of [left, middle, right]) {
    const isLateStructureChain = chain.some(({ x, y }) =>
      managerStructureIndices.has(toRoomIndex(x, y)),
    );

    if (!isLateStructureChain) {
      chain.forEach(block);
    }
  }

  block(corePlan.manager);
  block(corePlan.firstSpawn);
  block(corePlan.link);
  block(corePlan.terminal);
  block(corePlan.factory);
  block(corePlan.powerSpawn);

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

function visualizeStructureSlotPlan(
  plan: StructureSlotPlan,
  visual: RoomVisual,
): void {
  visual.text(plan.slots.length.toString(), 25, 1);

  plan.roads.forEach((road, index) => {
    visual.text(index.toString(), road.x, road.y);
    visual.structure(road.x, road.y, STRUCTURE_ROAD);
  });

  plan.slots.forEach((slot) =>
    visual.circle(slot.coordinate.x, slot.coordinate.y, {
      radius: 0.15,
      fill: "#ffffff",
      opacity: 0.65,
      stroke: "transparent",
    }),
  );
}
