import { dijkstraMap } from "../../world/map/dijkstraMap";
import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateInRange,
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { PlannedStructure } from "./basePlan";
import { classifyDefensiveTiles } from "./classifyDefensiveTiles";
import type { OuterRampartPlan } from "./planOuterRamparts";

const REPAIR_RANGE = 3;
const EXISTING_ROAD_COST = 3;
const PLAIN_COST = 5;
const SWAMP_COST = 6;
const DANGER_COST = 15;
const REQUIRED_REPAIR_POSITIONS = 1;
const DESIRED_REPAIR_POSITIONS = 2;

export interface RampartRepairRoadPlan {
  readonly roads: RoomCoordinate[];
  readonly unresolvedRamparts: RoomCoordinate[];
}

interface RepairRoadCandidate {
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
  readonly coverage: number;
}

/**
 * Extends the civil road network so every outer rampart has at least one
 * roaded repair position within range 3, and two whenever reachable.
 *
 * Dijkstra always starts from the core-plan roads. Existing civil roads and
 * newly added repair roads only reduce traversal cost; they never become new
 * sources. Outer ramparts themselves are never traversable.
 */
export function planRampartRepairRoads(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  structures: readonly PlannedStructure[],
  coreRoads: readonly RoomCoordinate[],
  existingRoads: readonly RoomCoordinate[],
  rampartPlan: OuterRampartPlan,
): RampartRepairRoadPlan | undefined {
  if (coreRoads.length === 0) {
    return;
  }

  const blockedMask = buildStandingBlockedMask(
    controller,
    sources,
    minerals,
    structures,
  );
  const defensiveTiles = classifyDefensiveTiles(rampartPlan);
  const roadMask = buildCoordinateMask(existingRoads);
  const selectedRepairMask = new Uint8Array(ROOM_AREA);
  const repairCounts = new Uint8Array(ROOM_AREA);
  const additions: RoomCoordinate[] = [];

  seedExistingRepairRoads(
    rampartPlan,
    defensiveTiles.repairMask,
    blockedMask,
    roadMask,
    selectedRepairMask,
    repairCounts,
  );

  extendRepairCoverage(
    terrain,
    coreRoads,
    rampartPlan,
    defensiveTiles.repairMask,
    defensiveTiles.dangerousMask,
    blockedMask,
    roadMask,
    selectedRepairMask,
    repairCounts,
    additions,
    REQUIRED_REPAIR_POSITIONS,
  );

  const unresolvedRamparts = rampartPlan.ramparts.filter(({ x, y }) => {
    return repairCounts[toRoomIndex(x, y)] < REQUIRED_REPAIR_POSITIONS;
  });

  if (unresolvedRamparts.length > 0) {
    return { roads: additions, unresolvedRamparts };
  }

  extendRepairCoverage(
    terrain,
    coreRoads,
    rampartPlan,
    defensiveTiles.repairMask,
    defensiveTiles.dangerousMask,
    blockedMask,
    roadMask,
    selectedRepairMask,
    repairCounts,
    additions,
    DESIRED_REPAIR_POSITIONS,
  );

  return { roads: additions, unresolvedRamparts: [] };
}

function seedExistingRepairRoads(
  rampartPlan: OuterRampartPlan,
  repairMask: Uint8Array,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
  selectedRepairMask: Uint8Array,
  repairCounts: Uint8Array,
): void {
  for (let index = 0; index < ROOM_AREA; index++) {
    if (
      !roadMask[index] ||
      !repairMask[index] ||
      blockedMask[index] ||
      rampartPlan.rampartMask[index]
    ) {
      continue;
    }

    selectedRepairMask[index] = 1;
    addRepairCoverage(fromRoomIndex(index), rampartPlan, repairCounts);
  }
}

function extendRepairCoverage(
  terrain: RoomTerrain,
  coreRoads: readonly RoomCoordinate[],
  rampartPlan: OuterRampartPlan,
  repairMask: Uint8Array,
  dangerousMask: Uint8Array,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
  selectedRepairMask: Uint8Array,
  repairCounts: Uint8Array,
  additions: RoomCoordinate[],
  targetCoverage: number,
): void {
  while (hasRampartBelowCoverage(rampartPlan, repairCounts, targetCoverage)) {
    const distances = buildRepairRoadDistanceMap(
      terrain,
      coreRoads,
      rampartPlan,
      dangerousMask,
      blockedMask,
      roadMask,
    );
    const target = findBestRepairRoadTarget(
      rampartPlan,
      repairMask,
      blockedMask,
      selectedRepairMask,
      repairCounts,
      targetCoverage,
      distances,
    );

    if (!target) {
      return;
    }

    const path = traceRepairRoadPath(
      terrain,
      target.coordinate,
      distances,
      dangerousMask,
      roadMask,
    );

    if (!path) {
      return;
    }

    addRoadPath(path, roadMask, additions);

    const targetIndex = toRoomIndex(target.coordinate.x, target.coordinate.y);
    selectedRepairMask[targetIndex] = 1;
    addRepairCoverage(target.coordinate, rampartPlan, repairCounts);
  }
}

function hasRampartBelowCoverage(
  rampartPlan: OuterRampartPlan,
  repairCounts: Uint8Array,
  targetCoverage: number,
): boolean {
  return rampartPlan.ramparts.some(({ x, y }) => {
    return repairCounts[toRoomIndex(x, y)] < targetCoverage;
  });
}

function buildRepairRoadDistanceMap(
  terrain: RoomTerrain,
  coreRoads: readonly RoomCoordinate[],
  rampartPlan: OuterRampartPlan,
  dangerousMask: Uint8Array,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    coreRoads,
    (x, y, terrainType) =>
      getRepairRoadCost(
        toRoomIndex(x, y),
        terrainType,
        dangerousMask,
        roadMask,
      ),
    (x, y) => {
      const index = toRoomIndex(x, y);
      return !!(
        rampartPlan.insideMask[index] &&
        !rampartPlan.rampartMask[index] &&
        !blockedMask[index]
      );
    },
  );
}

function findBestRepairRoadTarget(
  rampartPlan: OuterRampartPlan,
  repairMask: Uint8Array,
  blockedMask: Uint8Array,
  selectedRepairMask: Uint8Array,
  repairCounts: Uint8Array,
  targetCoverage: number,
  distances: Int32Array,
): RepairRoadCandidate | undefined {
  let best: RepairRoadCandidate | undefined;

  for (let index = 0; index < ROOM_AREA; index++) {
    if (
      !repairMask[index] ||
      blockedMask[index] ||
      selectedRepairMask[index] ||
      distances[index] < 0
    ) {
      continue;
    }

    const coordinate = fromRoomIndex(index);
    const coverage = countNeededRampartsInRange(
      coordinate,
      rampartPlan,
      repairCounts,
      targetCoverage,
    );

    if (coverage === 0) {
      continue;
    }

    const candidate: RepairRoadCandidate = {
      coordinate,
      distance: distances[index],
      coverage,
    };

    if (!best || isBetterRepairRoadCandidate(candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

function isBetterRepairRoadCandidate(
  candidate: RepairRoadCandidate,
  best: RepairRoadCandidate,
): boolean {
  const candidateWeightedDistance = candidate.distance * best.coverage;
  const bestWeightedDistance = best.distance * candidate.coverage;

  if (candidateWeightedDistance !== bestWeightedDistance) {
    return candidateWeightedDistance < bestWeightedDistance;
  }

  if (candidate.coverage !== best.coverage) {
    return candidate.coverage > best.coverage;
  }

  if (candidate.distance !== best.distance) {
    return candidate.distance < best.distance;
  }

  return (
    toRoomIndex(candidate.coordinate.x, candidate.coordinate.y) <
    toRoomIndex(best.coordinate.x, best.coordinate.y)
  );
}

function countNeededRampartsInRange(
  coordinate: RoomCoordinate,
  rampartPlan: OuterRampartPlan,
  repairCounts: Uint8Array,
  targetCoverage: number,
): number {
  let coverage = 0;

  forEachCoordinateInRange(coordinate, REPAIR_RANGE, (x, y) => {
    const index = toRoomIndex(x, y);

    if (
      rampartPlan.rampartMask[index] &&
      repairCounts[index] < targetCoverage
    ) {
      coverage++;
    }
  });

  return coverage;
}

function addRepairCoverage(
  coordinate: RoomCoordinate,
  rampartPlan: OuterRampartPlan,
  repairCounts: Uint8Array,
): void {
  forEachCoordinateInRange(coordinate, REPAIR_RANGE, (x, y) => {
    const index = toRoomIndex(x, y);

    if (
      rampartPlan.rampartMask[index] &&
      repairCounts[index] < DESIRED_REPAIR_POSITIONS
    ) {
      repairCounts[index]++;
    }
  });
}

function traceRepairRoadPath(
  terrain: RoomTerrain,
  start: RoomCoordinate,
  distances: Int32Array,
  dangerousMask: Uint8Array,
  roadMask: Uint8Array,
): RoomCoordinate[] | undefined {
  let currentIndex = toRoomIndex(start.x, start.y);

  if (distances[currentIndex] < 0) {
    return;
  }

  const path: RoomCoordinate[] = [];

  while (distances[currentIndex] > 0) {
    const current = fromRoomIndex(currentIndex);
    const currentDistance = distances[currentIndex];

    if (!roadMask[currentIndex]) {
      path.push(current);
    }

    const currentCost = getRepairRoadCost(
      currentIndex,
      terrain.get(current.x, current.y),
      dangerousMask,
      roadMask,
    );
    let bestRoadIndex = -1;
    let bestIndex = -1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborX = current.x + offset.x;
      const neighborY = current.y + offset.y;

      if (!isInsideRoom(neighborX, neighborY)) {
        continue;
      }

      const neighborIndex = toRoomIndex(neighborX, neighborY);
      const neighborDistance = distances[neighborIndex];

      if (
        neighborDistance < 0 ||
        neighborDistance + currentCost !== currentDistance
      ) {
        continue;
      }

      if (roadMask[neighborIndex]) {
        if (bestRoadIndex < 0 || neighborIndex < bestRoadIndex) {
          bestRoadIndex = neighborIndex;
        }
        continue;
      }

      if (bestIndex < 0 || neighborIndex < bestIndex) {
        bestIndex = neighborIndex;
      }
    }

    const nextIndex = bestRoadIndex >= 0 ? bestRoadIndex : bestIndex;

    if (nextIndex < 0) {
      return;
    }

    currentIndex = nextIndex;
  }

  return path;
}

function addRoadPath(
  path: readonly RoomCoordinate[],
  roadMask: Uint8Array,
  additions: RoomCoordinate[],
): void {
  for (const coordinate of path) {
    const index = toRoomIndex(coordinate.x, coordinate.y);

    if (roadMask[index]) {
      continue;
    }

    roadMask[index] = 1;
    additions.push(coordinate);
  }
}

function getRepairRoadCost(
  index: number,
  terrainType: number,
  dangerousMask: Uint8Array,
  roadMask: Uint8Array,
): number {
  if (dangerousMask[index]) {
    return DANGER_COST;
  }

  if (roadMask[index]) {
    return EXISTING_ROAD_COST;
  }

  return terrainType === TERRAIN_MASK_SWAMP ? SWAMP_COST : PLAIN_COST;
}

function buildStandingBlockedMask(
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  structures: readonly PlannedStructure[],
): Uint8Array {
  const blockedMask = new Uint8Array(ROOM_AREA);
  const block = ({ x, y }: RoomCoordinate): void => {
    blockedMask[toRoomIndex(x, y)] = 1;
  };

  block(controller.pos);
  sources.forEach(({ pos }) => block(pos));
  minerals.forEach(({ pos }) => block(pos));

  for (const structure of structures) {
    if (structure.structureType === STRUCTURE_CONTAINER) {
      continue;
    }

    block(structure.coordinate);
  }

  return blockedMask;
}

function buildCoordinateMask(
  coordinates: readonly RoomCoordinate[],
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of coordinates) {
    mask[toRoomIndex(x, y)] = 1;
  }

  return mask;
}
