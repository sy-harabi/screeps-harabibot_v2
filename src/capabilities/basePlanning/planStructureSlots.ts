import { dijkstraMap } from "../../world/map/dijkstraMap";
import { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  ROOM_SIZE,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";
import { LabPlan } from "./planLabs";
import { RegionBoundaryRoadPlan } from "./planRegionBoundaryRoads";
import { ResourceTreePlan } from "./planResourceTree";

const REQUIRED_STRUCTURE_SLOTS = 70;
const MAX_SERVICE_DISTANCE = ROOM_SIZE;

interface BranchCandidate {
  readonly newRoadIndices: number[];
  readonly newRoadDistances: number[];
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

  let plan: StructureSlotPlan | undefined;

  for (
    let maxServiceDistance = 0;
    maxServiceDistance <= MAX_SERVICE_DISTANCE;
    maxServiceDistance++
  ) {
    plan = findGreedySlotPlan(
      terrain,
      mandatoryRoadMask,
      blockedMask,
      maxServiceDistance,
      planningMask,
      corePlan,
    );

    if (plan.complete) {
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
  maxServiceDistance: number,
  planningMask: Uint8Array,
  corePlan: CorePlan,
): StructureSlotPlan {
  const serviceRoadMask = mandatoryRoadMask.slice();
  const addedRoadMask = new Uint8Array(ROOM_AREA);

  let serviceDistanceMap = buildServiceDistanceMap(
    terrain,
    serviceRoadMask,
    corePlan,
  );

  let slots = collectStructureSlots(
    terrain,
    serviceRoadMask,
    mandatoryRoadMask,
    blockedMask,
    planningMask,
    serviceDistanceMap,
    maxServiceDistance,
  );

  while (slots.length < REQUIRED_STRUCTURE_SLOTS) {
    const candidates = generateBranchCandidates(
      terrain,
      serviceRoadMask,
      serviceDistanceMap,
      maxServiceDistance,
      planningMask,
      blockedMask,
    );

    let bestCandidate: BranchCandidate | undefined;
    let bestGain = 0;
    let bestCost = Infinity;

    for (const candidate of candidates) {
      const candidateRoadMask = serviceRoadMask.slice();
      const candidateDistanceMap = serviceDistanceMap.slice();

      for (let i = 0; i < candidate.newRoadIndices.length; i++) {
        const index = candidate.newRoadIndices[i];
        const distance = candidate.newRoadDistances[i];

        candidateRoadMask[index] = 1;
        candidateDistanceMap[index] = distance;
      }

      const candidateSlots = collectStructureSlots(
        terrain,
        candidateRoadMask,
        mandatoryRoadMask,
        blockedMask,
        planningMask,
        candidateDistanceMap,
        maxServiceDistance,
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
      bestGain = gain;
      bestCost = cost;
    }

    if (!bestCandidate) {
      break;
    }

    for (const index of bestCandidate.newRoadIndices) {
      serviceRoadMask[index] = 1;
      addedRoadMask[index] = 1;
    }

    // Branches change the actual road-network distance. Recompute after every
    // accepted branch so later candidates expand from the shortest current
    // service-road paths instead of a static terrain-distance map.
    serviceDistanceMap = buildServiceDistanceMap(
      terrain,
      serviceRoadMask,
      corePlan,
    );

    slots = collectStructureSlots(
      terrain,
      serviceRoadMask,
      mandatoryRoadMask,
      blockedMask,
      planningMask,
      serviceDistanceMap,
      maxServiceDistance,
    );
  }

  const complete = slots.length >= REQUIRED_STRUCTURE_SLOTS - 5;

  return {
    slots,
    roads: collectCoordinates(addedRoadMask),
    complete,
  };
}

function generateBranchCandidates(
  terrain: RoomTerrain,
  serviceRoadMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
  planningMask: Uint8Array,
  blockedMask: Uint8Array,
): BranchCandidate[] {
  const candidates: BranchCandidate[] = [];
  const seen = new Set<string>();

  for (let rootIndex = 0; rootIndex < ROOM_AREA; rootIndex++) {
    if (!serviceRoadMask[rootIndex]) {
      continue;
    }

    const rootDistance = serviceDistanceMap[rootIndex];

    if (rootDistance < 0 || rootDistance > maxServiceDistance) {
      continue;
    }

    const root = fromRoomIndex(rootIndex);

    for (const direction of NEIGHBOR_OFFSETS) {
      const newRoadIndices: number[] = [];
      const newRoadDistances: number[] = [];
      let currentDistance = rootDistance;

      for (let step = 1; step <= 3; step++) {
        const x = root.x + direction.x * step;
        const y = root.y + direction.y * step;

        if (!isInsideRoom(x, y)) {
          break;
        }

        if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
          break;
        }

        const index = toRoomIndex(x, y);

        if (!planningMask[index] || blockedMask[index]) {
          break;
        }

        let nextDistance = currentDistance + 1;
        const existingDistance = serviceDistanceMap[index];

        if (serviceRoadMask[index] && existingDistance >= 0) {
          nextDistance = Math.min(nextDistance, existingDistance);
        }

        if (nextDistance > maxServiceDistance) {
          break;
        }

        currentDistance = nextDistance;

        if (!serviceRoadMask[index]) {
          newRoadIndices.push(index);
          newRoadDistances.push(currentDistance);
        }
      }

      if (newRoadIndices.length < 2) {
        continue;
      }

      const key = [...newRoadIndices].sort((left, right) => left - right).join(",");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({ newRoadIndices, newRoadDistances });
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
  maxServiceDistance: number,
): StructureSlot[] {
  const slotDistanceMap = new Int16Array(ROOM_AREA);
  slotDistanceMap.fill(-1);

  for (let roadIndex = 0; roadIndex < ROOM_AREA; roadIndex++) {
    if (!serviceRoadMask[roadIndex]) {
      continue;
    }

    const roadDistance = serviceDistanceMap[roadIndex];

    if (roadDistance < 0 || roadDistance > maxServiceDistance) {
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

      const slotDistance = roadDistance + 1;
      const previousDistance = slotDistanceMap[index];

      if (previousDistance < 0 || slotDistance < previousDistance) {
        slotDistanceMap[index] = slotDistance;
      }
    }
  }

  const slots: StructureSlot[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    const serviceDistance = slotDistanceMap[index];

    if (serviceDistance < 0) {
      continue;
    }

    slots.push({
      coordinate: fromRoomIndex(index),
      serviceDistance,
    });
  }

  return slots;
}

function buildServiceDistanceMap(
  terrain: RoomTerrain,
  serviceRoadMask: Uint8Array,
  corePlan: CorePlan,
): Int32Array {
  return dijkstraMap(
    terrain,
    corePlan.roads,
    () => 1,
    (x, y) => serviceRoadMask[toRoomIndex(x, y)] === 1,
  );
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
