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
const MAX_BRANCH_LENGTH = 3;
const SERVICE_DISTANCE_STEP = MAX_BRANCH_LENGTH;
const MAX_SERVICE_DISTANCE = ROOM_SIZE;
const SPAWN_ACCESS_PLAIN_COST = 5;
const SPAWN_ACCESS_SWAMP_COST = 6;

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
  existingSpawn?: RoomCoordinate,
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
    existingSpawn,
  );

  const spawnAccessRoads = existingSpawn
    ? planExistingSpawnAccessRoads(
        terrain,
        existingSpawn,
        mandatoryRoadMask,
        blockedMask,
        planningMask,
      )
    : [];

  if (spawnAccessRoads === undefined) {
    return;
  }

  for (const road of spawnAccessRoads) {
    mandatoryRoadMask[toRoomIndex(road.x, road.y)] = 1;
  }

  const slotPlan = findGreedySlotPlan(
    terrain,
    mandatoryRoadMask,
    blockedMask,
    planningMask,
    corePlan,
  );
  const plan: StructureSlotPlan = {
    ...slotPlan,
    roads: [...spawnAccessRoads, ...slotPlan.roads],
  };

  visualizeStructureSlotPlan(plan, visual);

  return plan;
}

function planExistingSpawnAccessRoads(
  terrain: RoomTerrain,
  existingSpawn: RoomCoordinate,
  mandatoryRoadMask: Uint8Array,
  blockedMask: Uint8Array,
  planningMask: Uint8Array,
): RoomCoordinate[] | undefined {
  const roadRoots = collectCoordinates(mandatoryRoadMask);

  if (roadRoots.length === 0) {
    return;
  }

  const distanceMap = dijkstraMap(
    terrain,
    roadRoots,
    (_x, _y, terrainType) => getSpawnAccessRoadCost(terrainType),
    (x, y) => {
      const index = toRoomIndex(x, y);
      return planningMask[index] === 1 && blockedMask[index] === 0;
    },
  );

  let targetIndex = -1;
  let targetDistance = Infinity;

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = existingSpawn.x + offset.x;
    const y = existingSpawn.y + offset.y;

    if (!isInsideRoom(x, y)) {
      continue;
    }

    const index = toRoomIndex(x, y);
    const distance = distanceMap[index];

    if (distance < 0) {
      continue;
    }

    if (
      distance < targetDistance ||
      (distance === targetDistance && (targetIndex < 0 || index < targetIndex))
    ) {
      targetIndex = index;
      targetDistance = distance;
    }
  }

  if (targetIndex < 0) {
    return;
  }

  const path: RoomCoordinate[] = [];
  let currentIndex = targetIndex;

  while (!mandatoryRoadMask[currentIndex]) {
    const current = fromRoomIndex(currentIndex);
    const currentDistance = distanceMap[currentIndex];

    if (currentDistance <= 0) {
      return;
    }

    path.push(current);

    const currentCost = getSpawnAccessRoadCost(
      terrain.get(current.x, current.y),
    );
    let nextIndex = -1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const neighborIndex = toRoomIndex(x, y);
      const neighborDistance = distanceMap[neighborIndex];

      if (
        neighborDistance < 0 ||
        neighborDistance + currentCost !== currentDistance
      ) {
        continue;
      }

      if (
        nextIndex < 0 ||
        mandatoryRoadMask[neighborIndex] ||
        (!mandatoryRoadMask[nextIndex] && neighborIndex < nextIndex)
      ) {
        nextIndex = neighborIndex;
      }
    }

    if (nextIndex < 0) {
      return;
    }

    currentIndex = nextIndex;
  }

  return path;
}

function getSpawnAccessRoadCost(terrainType: number): number {
  return terrainType === TERRAIN_MASK_SWAMP
    ? SPAWN_ACCESS_SWAMP_COST
    : SPAWN_ACCESS_PLAIN_COST;
}

function findGreedySlotPlan(
  terrain: RoomTerrain,
  mandatoryRoadMask: Uint8Array,
  blockedMask: Uint8Array,
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
  let slots: StructureSlot[] = [];

  // Grow one persistent road network while the allowed road distance expands.
  // Each wave covers roughly one full branch length so nearby alternatives can
  // compete without making the expansion as strict as a one-tile wavefront.
  for (
    let distanceLimit = SERVICE_DISTANCE_STEP;
    distanceLimit <= MAX_SERVICE_DISTANCE + SERVICE_DISTANCE_STEP - 1;
    distanceLimit += SERVICE_DISTANCE_STEP
  ) {
    const maxServiceDistance = Math.min(distanceLimit, MAX_SERVICE_DISTANCE);

    slots = collectStructureSlots(
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

      // An accepted branch can shorten the path to existing roads as well as
      // extend the network, so recalculate actual road-network distances.
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

    if (slots.length >= REQUIRED_STRUCTURE_SLOTS) {
      break;
    }
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

      for (let step = 1; step <= MAX_BRANCH_LENGTH; step++) {
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

      const key = newRoadIndices
        .map((index, i) => `${index}:${newRoadDistances[i]}`)
        .sort()
        .join(",");

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
  existingSpawn?: RoomCoordinate,
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
      block(chain[0]);
    }
  }

  block(corePlan.manager);
  block(corePlan.firstSpawn);
  block(corePlan.link);
  block(corePlan.terminal);
  block(corePlan.factory);
  block(corePlan.powerSpawn);

  corePlan.parking.forEach(block);

  if (existingSpawn) {
    block(existingSpawn);
  }

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
  plan.roads.forEach((road) => {
    visual.structure(road.x, road.y, STRUCTURE_ROAD);
  });
}
