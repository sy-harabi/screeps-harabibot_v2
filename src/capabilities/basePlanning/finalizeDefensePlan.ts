import { dijkstraMap } from "../../world/map/dijkstraMap";
import { floodFill } from "../../world/map/floodFill";
import { findMinimumTileCut } from "../../world/map/minCut";
import type { RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  forEachCoordinateAtRange,
  forEachCoordinateInRange,
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  ROOM_SIZE,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { PlannedStructure } from "./basePlan";
import { classifyDefensiveTiles } from "./classifyDefensiveTiles";
import type { CorePlan } from "./findCorePlans";
import type { OuterRampartPlan } from "./planOuterRamparts";

const PROTECTION_RANGE = 3;
const REPAIR_RANGE = 3;
const EXIT_SINK_RANGE = 1;
const BASE_RAMPART_COST = 1;
const BASE_DISTANCE = 15;
const MAX_FINAL_RAMPART_ATTEMPTS = 5;

interface RepairStationPlan {
  readonly ramparts: RoomCoordinate[];
  readonly unresolvedRamparts: RoomCoordinate[];
}

/**
 * Replaces the provisional planning ramparts and rampart-only roads with a
 * final defense plan based on the actual placed structures.
 *
 * The provisional road graph is first pruned back to roads that are useful for
 * reaching real structures from the core. A second min-cut then protects only
 * meaningful structures. Final rampart roads are rebuilt from the retained
 * civil network. Repair gaps are first covered by adding ramparts to accessible
 * dangerous standing tiles; only gaps that still cannot be repaired force the
 * min-cut outward and trigger another attempt.
 */
export function finalizeDefensePlan(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  provisionalStructures: readonly PlannedStructure[],
  corePlan: CorePlan,
  visual: RoomVisual,
): PlannedStructure[] | undefined {
  const baseStructures = provisionalStructures.filter(
    ({ structureType }) =>
      structureType !== STRUCTURE_ROAD && structureType !== STRUCTURE_RAMPART,
  );
  const civilRoads = pruneCivilRoadNetwork(
    provisionalStructures,
    corePlan.roads,
  );

  if (civilRoads.length === 0) {
    return;
  }

  const forcedInsideMask = new Uint8Array(ROOM_AREA);

  for (let attempt = 0; attempt < MAX_FINAL_RAMPART_ATTEMPTS; attempt++) {
    const rampartPlan = planFinalRamparts(
      terrain,
      controller,
      baseStructures,
      forcedInsideMask,
    );

    if (!rampartPlan) {
      return;
    }

    const internalCivilRoads = civilRoads.filter(({ x, y }) => {
      const index = toRoomIndex(x, y);
      return !!(
        rampartPlan.insideMask[index] || rampartPlan.rampartMask[index]
      );
    });

    const defenseRoads = planFinalDefenseRoads(
      terrain,
      controller,
      sources,
      minerals,
      baseStructures,
      internalCivilRoads,
      rampartPlan,
    );

    if (!defenseRoads) {
      return;
    }

    const repairRoadMask = buildCoordinateMask([
      ...internalCivilRoads,
      ...defenseRoads,
    ]);
    const repairPlan = planRepairStations(
      terrain,
      controller,
      sources,
      minerals,
      baseStructures,
      rampartPlan,
      repairRoadMask,
    );

    if (repairPlan.unresolvedRamparts.length === 0) {
      const result = assembleFinalStructures(
        provisionalStructures,
        baseStructures,
        civilRoads,
        defenseRoads,
        rampartPlan.ramparts,
        repairPlan.ramparts,
      );

      visualizeFinalPlan(result, visual);
      return result;
    }

    for (const { x, y } of repairPlan.unresolvedRamparts) {
      forcedInsideMask[toRoomIndex(x, y)] = 1;
    }
  }

  return;
}

/**
 * Keeps only roads that participate in a path from the core road network to a
 * meaningful structure. This intentionally removes provisional roads whose
 * only purpose was reaching the first-pass ramparts.
 */
function pruneCivilRoadNetwork(
  structures: readonly PlannedStructure[],
  coreRoads: readonly RoomCoordinate[],
): RoomCoordinate[] {
  const roadMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_ROAD) {
      continue;
    }

    const { x, y } = structure.coordinate;
    roadMask[toRoomIndex(x, y)] = 1;
  }

  const distance = new Int16Array(ROOM_AREA);
  distance.fill(-1);
  const parent = new Int16Array(ROOM_AREA);
  parent.fill(-1);
  const queue = new Int16Array(ROOM_AREA);
  let queueHead = 0;
  let queueTail = 0;
  const retainedMask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of coreRoads) {
    const index = toRoomIndex(x, y);

    if (!roadMask[index] || distance[index] >= 0) {
      continue;
    }

    distance[index] = 0;
    parent[index] = index;
    retainedMask[index] = 1;
    queue[queueTail++] = index;
  }

  while (queueHead < queueTail) {
    const currentIndex = queue[queueHead++];
    const current = fromRoomIndex(currentIndex);

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const neighborIndex = toRoomIndex(x, y);

      if (!roadMask[neighborIndex] || distance[neighborIndex] >= 0) {
        continue;
      }

      distance[neighborIndex] = distance[currentIndex] + 1;
      parent[neighborIndex] = currentIndex;
      queue[queueTail++] = neighborIndex;
    }
  }

  for (const structure of structures) {
    if (!isRoadServiceTarget(structure)) {
      continue;
    }

    const targetRoadIndex = findClosestReachableRoad(
      structure.coordinate,
      roadMask,
      distance,
    );

    if (targetRoadIndex < 0) {
      continue;
    }

    let currentIndex = targetRoadIndex;

    while (currentIndex >= 0 && !retainedMask[currentIndex]) {
      retainedMask[currentIndex] = 1;
      const nextIndex = parent[currentIndex];

      if (nextIndex === currentIndex) {
        break;
      }

      currentIndex = nextIndex;
    }
  }

  return coordinatesFromMask(retainedMask);
}

function isRoadServiceTarget(structure: PlannedStructure): boolean {
  return (
    structure.structureType !== STRUCTURE_ROAD &&
    structure.structureType !== STRUCTURE_RAMPART &&
    structure.structureType !== STRUCTURE_EXTRACTOR
  );
}

function findClosestReachableRoad(
  coordinate: RoomCoordinate,
  roadMask: Uint8Array,
  distance: Int16Array,
): number {
  let bestIndex = -1;
  let bestDistance = Infinity;

  const consider = (x: number, y: number): void => {
    if (!isInsideRoom(x, y)) {
      return;
    }

    const index = toRoomIndex(x, y);
    const candidateDistance = distance[index];

    if (
      !roadMask[index] ||
      candidateDistance < 0 ||
      candidateDistance > bestDistance ||
      (candidateDistance === bestDistance && index >= bestIndex && bestIndex >= 0)
    ) {
      return;
    }

    bestIndex = index;
    bestDistance = candidateDistance;
  };

  consider(coordinate.x, coordinate.y);

  for (const offset of NEIGHBOR_OFFSETS) {
    consider(coordinate.x + offset.x, coordinate.y + offset.y);
  }

  return bestIndex;
}

function planFinalRamparts(
  terrain: RoomTerrain,
  controller: StructureController,
  structures: readonly PlannedStructure[],
  forcedInsideMask: Uint8Array,
): OuterRampartPlan | undefined {
  const sourceMask = buildFinalSourceMask(
    terrain,
    structures,
    forcedInsideMask,
  );
  const sinkMask = buildExitSinkMask(terrain);
  const tileCosts = buildControllerDistanceCosts(terrain, controller.pos);
  const result = findMinimumTileCut(terrain, sourceMask, sinkMask, tileCosts);

  if (!result || result.cuts.length === 0) {
    return;
  }

  return {
    ramparts: result.cuts,
    rampartMask: result.cutMask,
    insideMask: result.insideMask,
    outsideMask: result.outsideMask,
  };
}

function buildFinalSourceMask(
  terrain: RoomTerrain,
  structures: readonly PlannedStructure[],
  forcedInsideMask: Uint8Array,
): Uint8Array {
  const sourceMask = forcedInsideMask.slice();

  for (const structure of structures) {
    if (!isProtectedStructure(structure)) {
      continue;
    }

    forEachCoordinateInRange(
      structure.coordinate,
      PROTECTION_RANGE,
      (x, y) => {
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          sourceMask[toRoomIndex(x, y)] = 1;
        }
      },
    );
  }

  return sourceMask;
}

function isProtectedStructure(structure: PlannedStructure): boolean {
  if (
    structure.structureType === STRUCTURE_ROAD ||
    structure.structureType === STRUCTURE_RAMPART ||
    structure.structureType === STRUCTURE_CONTAINER ||
    structure.structureType === STRUCTURE_EXTRACTOR
  ) {
    return false;
  }

  return structure.tag?.kind !== "source" && structure.tag?.kind !== "mineral";
}

function buildExitSinkMask(terrain: RoomTerrain): Uint8Array {
  const sinkMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index);

    if (x !== 0 && x !== ROOM_SIZE - 1 && y !== 0 && y !== ROOM_SIZE - 1) {
      continue;
    }

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      continue;
    }

    for (let dy = -EXIT_SINK_RANGE; dy <= EXIT_SINK_RANGE; dy++) {
      for (let dx = -EXIT_SINK_RANGE; dx <= EXIT_SINK_RANGE; dx++) {
        const sinkX = x + dx;
        const sinkY = y + dy;

        if (!isInsideRoom(sinkX, sinkY)) {
          continue;
        }

        if (terrain.get(sinkX, sinkY) === TERRAIN_MASK_WALL) {
          continue;
        }

        sinkMask[toRoomIndex(sinkX, sinkY)] = 1;
      }
    }
  }

  return sinkMask;
}

function buildControllerDistanceCosts(
  terrain: RoomTerrain,
  controller: RoomCoordinate,
): Uint16Array {
  const starts: RoomCoordinate[] = [];

  forEachCoordinateAtRange(controller, 1, (x, y) => {
    starts.push({ x, y });
  });

  const { distances } = floodFill(terrain, starts);
  const costs = new Uint16Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const distance = distances[index];
    const distanceFactor =
      distance > BASE_DISTANCE ? distance - BASE_DISTANCE : 0;
    costs[index] = BASE_RAMPART_COST + distanceFactor;
  }

  return costs;
}

function planFinalDefenseRoads(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  structures: readonly PlannedStructure[],
  civilRoads: readonly RoomCoordinate[],
  rampartPlan: OuterRampartPlan,
): RoomCoordinate[] | undefined {
  if (civilRoads.length === 0) {
    return;
  }

  const roadMask = buildCoordinateMask(civilRoads);
  const blockedMask = buildStandingBlockedMask(
    controller,
    sources,
    minerals,
    structures,
  );
  const components = findRampartComponents(rampartPlan.rampartMask);
  const remainingComponents = components.map((_, index) => index);
  const additions: RoomCoordinate[] = [];

  while (remainingComponents.length > 0) {
    const currentRoads = coordinatesFromMask(roadMask);
    const distances = dijkstraMap(
      terrain,
      currentRoads,
      (x, y, terrainType) =>
        getDefenseRoadCost(toRoomIndex(x, y), terrainType, roadMask),
      (x, y) => {
        const index = toRoomIndex(x, y);
        return !!(
          (rampartPlan.insideMask[index] || rampartPlan.rampartMask[index]) &&
          !blockedMask[index]
        );
      },
    );

    const target = findClosestRampartTarget(
      components,
      remainingComponents,
      distances,
    );

    if (!target) {
      return;
    }

    const path = traceDefenseRoadPath(
      terrain,
      target.coordinate,
      distances,
      roadMask,
    );

    if (!path) {
      return;
    }

    for (const coordinate of path) {
      const index = toRoomIndex(coordinate.x, coordinate.y);

      if (roadMask[index]) {
        continue;
      }

      roadMask[index] = 1;
      additions.push(coordinate);
    }

    remainingComponents.splice(
      remainingComponents.indexOf(target.componentIndex),
      1,
    );
  }

  return additions;
}

interface RampartComponent {
  readonly tileIndices: readonly number[];
}

interface RampartTarget {
  readonly componentIndex: number;
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
}

function findRampartComponents(rampartMask: Uint8Array): RampartComponent[] {
  const visited = new Uint8Array(ROOM_AREA);
  const components: RampartComponent[] = [];

  for (let startIndex = 0; startIndex < ROOM_AREA; startIndex++) {
    if (!rampartMask[startIndex] || visited[startIndex]) {
      continue;
    }

    const tileIndices = [startIndex];
    visited[startIndex] = 1;
    let queueHead = 0;

    while (queueHead < tileIndices.length) {
      const current = fromRoomIndex(tileIndices[queueHead++]);

      for (const offset of NEIGHBOR_OFFSETS) {
        const x = current.x + offset.x;
        const y = current.y + offset.y;

        if (!isInsideRoom(x, y)) {
          continue;
        }

        const neighborIndex = toRoomIndex(x, y);

        if (!rampartMask[neighborIndex] || visited[neighborIndex]) {
          continue;
        }

        visited[neighborIndex] = 1;
        tileIndices.push(neighborIndex);
      }
    }

    components.push({ tileIndices });
  }

  return components;
}

function findClosestRampartTarget(
  components: readonly RampartComponent[],
  remainingComponents: readonly number[],
  distances: Int32Array,
): RampartTarget | undefined {
  let best: RampartTarget | undefined;

  for (const componentIndex of remainingComponents) {
    for (const tileIndex of components[componentIndex].tileIndices) {
      const distance = distances[tileIndex];

      if (distance < 0) {
        continue;
      }

      if (
        best &&
        (distance > best.distance ||
          (distance === best.distance &&
            (componentIndex > best.componentIndex ||
              (componentIndex === best.componentIndex &&
                tileIndex >=
                  toRoomIndex(best.coordinate.x, best.coordinate.y)))))
      ) {
        continue;
      }

      best = {
        componentIndex,
        coordinate: fromRoomIndex(tileIndex),
        distance,
      };
    }
  }

  return best;
}

function traceDefenseRoadPath(
  terrain: RoomTerrain,
  start: RoomCoordinate,
  distances: Int32Array,
  roadMask: Uint8Array,
): RoomCoordinate[] | undefined {
  let currentIndex = toRoomIndex(start.x, start.y);

  if (distances[currentIndex] < 0) {
    return;
  }

  const path: RoomCoordinate[] = [];

  while (!roadMask[currentIndex]) {
    const current = fromRoomIndex(currentIndex);
    const currentDistance = distances[currentIndex];

    if (currentDistance <= 0) {
      return;
    }

    path.push(current);

    const currentCost = getDefenseRoadCost(
      currentIndex,
      terrain.get(current.x, current.y),
      roadMask,
    );
    let bestRoadIndex = -1;
    let bestIndex = -1;

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x;
      const y = current.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      const neighborIndex = toRoomIndex(x, y);
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

function getDefenseRoadCost(
  index: number,
  terrainType: number,
  roadMask: Uint8Array,
): number {
  if (roadMask[index]) {
    return 3;
  }

  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5;
}

function planRepairStations(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  structures: readonly PlannedStructure[],
  rampartPlan: OuterRampartPlan,
  roadMask: Uint8Array,
): RepairStationPlan {
  const defensiveTiles = classifyDefensiveTiles(rampartPlan);
  const blockedMask = buildStandingBlockedMask(
    controller,
    sources,
    minerals,
    structures,
  );
  const uncovered = new Set<number>();

  for (const rampart of rampartPlan.ramparts) {
    const rampartIndex = toRoomIndex(rampart.x, rampart.y);

    if (
      !hasAccessibleSafeRepairTile(
        rampart,
        defensiveTiles.safeRepairCandidateMask,
        blockedMask,
        roadMask,
      )
    ) {
      uncovered.add(rampartIndex);
    }
  }

  const repairRamparts: RoomCoordinate[] = [];

  while (uncovered.size > 0) {
    let bestCandidateIndex = -1;
    let bestAccessRank = Infinity;
    let bestCoverage: number[] = [];

    for (let index = 0; index < ROOM_AREA; index++) {
      if (
        !defensiveTiles.rampartRequiredRepairCandidateMask[index] ||
        blockedMask[index]
      ) {
        continue;
      }

      const accessRank = getRepairAccessRank(index, roadMask);

      if (accessRank < 0) {
        continue;
      }

      const coordinate = fromRoomIndex(index);
      const coverage: number[] = [];

      forEachCoordinateInRange(coordinate, REPAIR_RANGE, (x, y) => {
        const rampartIndex = toRoomIndex(x, y);

        if (uncovered.has(rampartIndex)) {
          coverage.push(rampartIndex);
        }
      });

      if (coverage.length === 0) {
        continue;
      }

      if (
        accessRank < bestAccessRank ||
        (accessRank === bestAccessRank &&
          (coverage.length > bestCoverage.length ||
            (coverage.length === bestCoverage.length &&
              (bestCandidateIndex < 0 || index < bestCandidateIndex))))
      ) {
        bestCandidateIndex = index;
        bestAccessRank = accessRank;
        bestCoverage = coverage;
      }
    }

    if (bestCandidateIndex < 0) {
      break;
    }

    repairRamparts.push(fromRoomIndex(bestCandidateIndex));

    for (const coveredIndex of bestCoverage) {
      uncovered.delete(coveredIndex);
    }
  }

  const unresolvedRamparts = [...uncovered].map(fromRoomIndex);

  return { ramparts: repairRamparts, unresolvedRamparts };
}

function hasAccessibleSafeRepairTile(
  rampart: RoomCoordinate,
  safeRepairMask: Uint8Array,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
): boolean {
  let found = false;

  forEachCoordinateInRange(rampart, REPAIR_RANGE, (x, y) => {
    if (found) {
      return;
    }

    const index = toRoomIndex(x, y);

    if (
      safeRepairMask[index] &&
      !blockedMask[index] &&
      getRepairAccessRank(index, roadMask) >= 0
    ) {
      found = true;
    }
  });

  return found;
}

/** Returns 0 for a road tile, 1 for a tile adjacent to a road, and -1 otherwise. */
function getRepairAccessRank(index: number, roadMask: Uint8Array): number {
  if (roadMask[index]) {
    return 0;
  }

  const coordinate = fromRoomIndex(index);

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = coordinate.x + offset.x;
    const y = coordinate.y + offset.y;

    if (!isInsideRoom(x, y)) {
      continue;
    }

    if (roadMask[toRoomIndex(x, y)]) {
      return 1;
    }
  }

  return -1;
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

function assembleFinalStructures(
  provisionalStructures: readonly PlannedStructure[],
  baseStructures: readonly PlannedStructure[],
  civilRoads: readonly RoomCoordinate[],
  defenseRoads: readonly RoomCoordinate[],
  outerRamparts: readonly RoomCoordinate[],
  repairRamparts: readonly RoomCoordinate[],
): PlannedStructure[] {
  const structures: PlannedStructure[] = [...baseStructures];
  const seen = new Set(
    structures.map(
      ({ structureType, coordinate }) =>
        `${structureType}:${coordinate.x}:${coordinate.y}`,
    ),
  );
  const roadRcl =
    provisionalStructures.find(
      ({ structureType }) => structureType === STRUCTURE_ROAD,
    )?.rcl ?? getStructureRcl(STRUCTURE_ROAD);
  const rampartRcl =
    provisionalStructures.find(
      ({ structureType }) => structureType === STRUCTURE_RAMPART,
    )?.rcl ?? getStructureRcl(STRUCTURE_RAMPART);

  const add = (
    structureType: BuildableStructureConstant,
    coordinate: RoomCoordinate,
    rcl: number,
  ): void => {
    const key = `${structureType}:${coordinate.x}:${coordinate.y}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    structures.push({ structureType, coordinate, rcl });
  };

  for (const road of [...civilRoads, ...defenseRoads]) {
    add(STRUCTURE_ROAD, road, roadRcl);
  }

  for (const rampart of [...outerRamparts, ...repairRamparts]) {
    add(STRUCTURE_RAMPART, rampart, rampartRcl);
  }

  return structures;
}

function getStructureRcl(structureType: BuildableStructureConstant): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as Record<number, number>;

  for (let rcl = 1; rcl <= 8; rcl++) {
    if ((limits[rcl] ?? 0) > 0) {
      return rcl;
    }
  }

  return 8;
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

function coordinatesFromMask(mask: Uint8Array): RoomCoordinate[] {
  const coordinates: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (mask[index]) {
      coordinates.push(fromRoomIndex(index));
    }
  }

  return coordinates;
}

function visualizeFinalPlan(
  structures: readonly PlannedStructure[],
  visual: RoomVisual,
): void {
  visual.clear();

  for (const structure of structures) {
    visual.structure(
      structure.coordinate.x,
      structure.coordinate.y,
      structure.structureType,
    );
  }
}
