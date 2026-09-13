import { dijkstraMap } from "../../world/map/dijkstraMap";
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import { CorePlan } from "./findCorePlans";
import { RegionBoundaryRoadPlan } from "./planRegionBoundaryRoads";
import { ResourceTreePlan } from "./planResourceTree";

const MAX_SERVICE_DISTANCE = 20;
const MAX_BRANCH_LENGTH = 3;

interface LabLayout {
  readonly inputLabs: [RoomCoordinate, RoomCoordinate];
  readonly outputLabs: RoomCoordinate[];
}

export interface LabPlan {
  readonly inputLabs: [RoomCoordinate, RoomCoordinate];
  readonly outputLabs: RoomCoordinate[];
  readonly serviceRoads: RoomCoordinate[];
}

interface LabCandidate {
  readonly coordinate: RoomCoordinate;
  readonly serviceDistance: number;
}

export function planLabs(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  minerals: Mineral[],
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  visual: RoomVisual,
): LabPlan | undefined {
  const reservedMask = buildReservedMask(
    controller,
    sources,
    minerals,
    controllerArea,
    corePlan,
    resourceTree,
  );

  const serviceMask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of [
    ...corePlan.roads,
    ...resourceTree.roads,
    ...boundaryRoadPlan.roads,
  ]) {
    serviceMask[toRoomIndex(x, y)] = 1;
  }

  const serviceDistanceMap = buildServiceDistanceMap(
    terrain,
    serviceMask,
    corePlan.roads,
  );

  for (
    let maxServiceDistance = 0;
    maxServiceDistance <= MAX_SERVICE_DISTANCE;
    maxServiceDistance++
  ) {
    const layout = tryLabLayout(
      terrain,
      serviceMask,
      serviceDistanceMap,
      maxServiceDistance,
      reservedMask,
      selectedRegionIds,
      regionByTile,
    );

    if (layout) {
      const plan: LabPlan = {
        ...layout,
        serviceRoads: [],
      };

      visualizeLabPlan(plan, visual);
      return plan;
    }

    for (let branchLength = 1; branchLength <= MAX_BRANCH_LENGTH; branchLength++) {
      const plan = findLabPlanWithBranch(
        terrain,
        serviceMask,
        serviceDistanceMap,
        corePlan.roads,
        branchLength,
        maxServiceDistance,
        reservedMask,
        selectedRegionIds,
        regionByTile,
      );

      if (plan) {
        visualizeLabPlan(plan, visual);
        return plan;
      }
    }
  }

  return;
}

function findLabPlanWithBranch(
  terrain: RoomTerrain,
  baseServiceMask: Uint8Array,
  baseServiceDistanceMap: Int32Array,
  roots: readonly RoomCoordinate[],
  branchLength: number,
  maxServiceDistance: number,
  reservedMask: Uint8Array,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): LabPlan | undefined {
  if (maxServiceDistance === 0) {
    return;
  }

  const branchMask = new Uint8Array(ROOM_AREA);
  const branch: RoomCoordinate[] = [];
  const seenVariants = new Set<string>();

  const searchBranch = (
    current: RoomCoordinate,
    remainingLength: number,
  ): LabPlan | undefined => {
    if (remainingLength === 0) {
      const variantKey = branch
        .map(({ x, y }) => toRoomIndex(x, y))
        .sort((left, right) => left - right)
        .join(",");

      if (seenVariants.has(variantKey)) {
        return;
      }
      seenVariants.add(variantKey);

      const serviceMask = baseServiceMask.slice();

      for (const { x, y } of branch) {
        serviceMask[toRoomIndex(x, y)] = 1;
      }

      const serviceDistanceMap = buildServiceDistanceMap(
        terrain,
        serviceMask,
        roots,
      );

      for (const { x, y } of branch) {
        const serviceDistance = serviceDistanceMap[toRoomIndex(x, y)];

        if (
          serviceDistance < 0 ||
          serviceDistance > maxServiceDistance
        ) {
          return;
        }
      }

      const layout = tryLabLayout(
        terrain,
        serviceMask,
        serviceDistanceMap,
        maxServiceDistance,
        reservedMask,
        selectedRegionIds,
        regionByTile,
      );

      if (!layout) {
        return;
      }

      return {
        ...layout,
        serviceRoads: [...branch],
      };
    }

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const index = toRoomIndex(x, y);

      if (branchMask[index]) {
        continue;
      }

      if (baseServiceMask[index]) {
        continue;
      }

      if (reservedMask[index]) {
        continue;
      }

      if (!selectedRegionIds.has(regionByTile[index])) {
        continue;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      const coordinate = { x, y };
      branchMask[index] = 1;
      branch.push(coordinate);

      const plan = searchBranch(coordinate, remainingLength - 1);

      if (plan) {
        return plan;
      }

      branch.pop();
      branchMask[index] = 0;
    }

    return;
  };

  for (let serviceIndex = 0; serviceIndex < ROOM_AREA; serviceIndex++) {
    const serviceDistance = baseServiceDistanceMap[serviceIndex];

    if (serviceDistance < 0 || serviceDistance >= maxServiceDistance) {
      continue;
    }

    const plan = searchBranch(fromRoomIndex(serviceIndex), branchLength);

    if (plan) {
      return plan;
    }
  }

  return;
}

function tryLabLayout(
  terrain: RoomTerrain,
  serviceMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
  reservedMask: Uint8Array,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): LabLayout | undefined {
  const candidates = collectLabCandidates(
    terrain,
    serviceMask,
    serviceDistanceMap,
    maxServiceDistance,
    reservedMask,
    selectedRegionIds,
    regionByTile,
  );

  return findLabLayout(candidates);
}

function findLabLayout(
  candidates: readonly LabCandidate[],
): LabLayout | undefined {
  for (let firstIndex = 0; firstIndex < candidates.length - 1; firstIndex++) {
    const firstInput = candidates[firstIndex];

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < candidates.length;
      secondIndex++
    ) {
      const secondInput = candidates[secondIndex];

      if (
        !canSupportEightOutputs(firstInput.coordinate, secondInput.coordinate)
      ) {
        continue;
      }

      const outputLabs: RoomCoordinate[] = [];

      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        if (candidateIndex === firstIndex || candidateIndex === secondIndex) {
          continue;
        }

        const candidate = candidates[candidateIndex];

        if (
          getRange(candidate.coordinate, firstInput.coordinate) > 2 ||
          getRange(candidate.coordinate, secondInput.coordinate) > 2
        ) {
          continue;
        }

        outputLabs.push(candidate.coordinate);

        if (outputLabs.length === 8) {
          return {
            inputLabs: [firstInput.coordinate, secondInput.coordinate],
            outputLabs,
          };
        }
      }
    }
  }
  return;
}

function canSupportEightOutputs(
  firstInput: RoomCoordinate,
  secondInput: RoomCoordinate,
): boolean {
  const dx = Math.abs(firstInput.x - secondInput.x);
  const dy = Math.abs(firstInput.y - secondInput.y);

  if (dx > 4 || dy > 4) {
    return false;
  }

  const intersection = (5 - dx) * (5 - dy);
  const inputRange = Math.max(dx, dy);
  const inputPenalty = inputRange <= 2 ? 2 : 0;

  return intersection - inputPenalty >= 8;
}

function collectLabCandidates(
  terrain: RoomTerrain,
  serviceMask: Uint8Array,
  serviceDistanceMap: Int32Array,
  maxServiceDistance: number,
  reservedMask: Uint8Array,
  selectedRegionIds: Set<number>,
  regionByTile: Int16Array,
): LabCandidate[] {
  const candidateDistanceMap = new Int16Array(ROOM_AREA);
  candidateDistanceMap.fill(-1);

  for (let serviceIndex = 0; serviceIndex < ROOM_AREA; serviceIndex++) {
    const serviceDistance = serviceDistanceMap[serviceIndex];

    if (serviceDistance < 0 || serviceDistance > maxServiceDistance) {
      continue;
    }

    const serviceCoordinate = fromRoomIndex(serviceIndex);

    for (const offset of NEIGHBOR_OFFSETS) {
      const candidateX = serviceCoordinate.x + offset.x;
      const candidateY = serviceCoordinate.y + offset.y;

      if (!isInsideRoom(candidateX, candidateY)) {
        continue;
      }

      if (terrain.get(candidateX, candidateY) === TERRAIN_MASK_WALL) {
        continue;
      }

      const candidateIndex = toRoomIndex(candidateX, candidateY);

      if (reservedMask[candidateIndex]) {
        continue;
      }

      if (!selectedRegionIds.has(regionByTile[candidateIndex])) {
        continue;
      }

      if (serviceMask[candidateIndex]) {
        continue;
      }

      const previousDistance = candidateDistanceMap[candidateIndex];

      if (previousDistance === -1 || serviceDistance < previousDistance) {
        candidateDistanceMap[candidateIndex] = serviceDistance;
      }
    }
  }

  const candidates: LabCandidate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    const serviceDistance = candidateDistanceMap[index];

    if (serviceDistance < 0) {
      continue;
    }

    candidates.push({
      coordinate: fromRoomIndex(index),
      serviceDistance,
    });
  }

  candidates.sort(
    (left, right) =>
      left.serviceDistance - right.serviceDistance ||
      toRoomIndex(left.coordinate.x, left.coordinate.y) -
        toRoomIndex(right.coordinate.x, right.coordinate.y),
  );

  return candidates;
}

function buildServiceDistanceMap(
  terrain: RoomTerrain,
  serviceMask: Uint8Array,
  roots: readonly RoomCoordinate[],
): Int32Array {
  return dijkstraMap(
    terrain,
    roots,
    () => 1,
    (x, y) => serviceMask[toRoomIndex(x, y)] === 1,
  );
}

function buildReservedMask(
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
): Uint8Array {
  const reservedMask = new Uint8Array(ROOM_AREA);

  const reserve = ({ x, y }: RoomCoordinate): void => {
    reservedMask[toRoomIndex(x, y)] = 1;
  };

  reserve(controller.pos);
  reserve(controllerArea.storage);

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    chain.forEach(reserve);
  }

  reserve(corePlan.manager);
  reserve(corePlan.terminal);
  reserve(corePlan.firstSpawn);
  reserve(corePlan.link);
  reserve(corePlan.factory);
  reserve(corePlan.powerSpawn);
  corePlan.parking.forEach(reserve);

  for (const resource of [...sources, ...minerals]) {
    reserve(resource.pos);
  }

  for (const branch of resourceTree.branches) {
    reserve(branch.container);

    if (branch.link) {
      reserve(branch.link);
    }
  }

  return reservedMask;
}

function visualizeLabPlan(plan: LabPlan, visual: RoomVisual): void {
  plan.inputLabs.forEach((coordinate) =>
    visual.structure(coordinate.x, coordinate.y, STRUCTURE_LAB),
  );

  plan.outputLabs.forEach((coordinate) =>
    visual.structure(coordinate.x, coordinate.y, STRUCTURE_LAB),
  );

  plan.serviceRoads.forEach((coordinate) =>
    visual.structure(coordinate.x, coordinate.y, STRUCTURE_ROAD),
  );
}
