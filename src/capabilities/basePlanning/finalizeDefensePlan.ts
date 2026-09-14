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
import { planRampartRepairRoads } from "./planRampartRepairRoads";

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

interface RampartComponent {
  readonly tileIndices: readonly number[];
}

interface RampartTarget {
  readonly componentIndex: number;
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
}

interface SafeRepairRoadTarget {
  readonly coordinate: RoomCoordinate;
  readonly distance: number;
  readonly coverage: number;
}

/**
 * Replaces provisional planning ramparts and rampart-only roads with a final
 * defense plan based on the actual placed structures.
 *
 * Final min-cut components that cannot be reached from the civil road network
 * are treated as natural-wall islands and discarded. The topology is then
 * rebuilt from the remaining ramparts. Any final building or road that still
 * lies in the resulting ranged-attack danger zone receives an overlapping
 * rampart.
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
    const rawRampartPlan = planFinalRamparts(
      terrain,
      controller,
      baseStructures,
      forcedInsideMask,
    );

    if (!rawRampartPlan) {
      return;
    }

    const blockedMask = buildStandingBlockedMask(
      controller,
      sources,
      minerals,
      baseStructures,
    );
    const rampartPlan = discardInaccessibleRampartComponents(
      terrain,
      rawRampartPlan,
      civilRoads,
      blockedMask,
      baseStructures,
    );

    if (!rampartPlan || rampartPlan.ramparts.length === 0) {
      return;
    }

    // Resource roads may legitimately remain outside the final defensive line.
    // Only the internal part is used as the seed for final defense roads.
    const internalCivilRoads = civilRoads.filter(({ x, y }) => {
      const index = toRoomIndex(x, y);
      return !!rampartPlan.insideMask[index];
    });

    const repairRoadPlan = planRampartRepairRoads(
      terrain,
      controller,
      sources,
      minerals,
      baseStructures,
      corePlan.roads,
      internalCivilRoads,
      rampartPlan,
    );

    if (!repairRoadPlan) {
      return;
    }

    const defenseRoads = repairRoadPlan.roads;
    const finalRoads = [...civilRoads, ...defenseRoads];

    if (repairRoadPlan.unresolvedRamparts.length === 0) {
      const dangerousMask = classifyDefensiveTiles(rampartPlan).dangerousMask;
      const dangerRamparts = collectDangerOverlayRamparts(
        baseStructures,
        finalRoads,
        dangerousMask,
      );
      const result = assembleFinalStructures(
        provisionalStructures,
        baseStructures,
        civilRoads,
        defenseRoads,
        rampartPlan.ramparts,
        [],
        dangerRamparts,
      );

      visualizeFinalPlan(result, visual);
      return result;
    }

    // Only reachable outer-rampart tiles that still cannot be repaired force
    // the cut outward. Inaccessible natural-wall islands were already removed.
    for (const { x, y } of repairRoadPlan.unresolvedRamparts) {
      forcedInsideMask[toRoomIndex(x, y)] = 1;
    }
  }

  return;
}

/**
 * Floods the provisional road graph from core roads and retains only paths
 * needed to reach meaningful structures. Rampart-only branches disappear.
 */
function pruneCivilRoadNetwork(
  structures: readonly PlannedStructure[],
  coreRoads: readonly RoomCoordinate[],
): RoomCoordinate[] {
  const roadMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    if (structure.structureType === STRUCTURE_ROAD) {
      const { x, y } = structure.coordinate;
      roadMask[toRoomIndex(x, y)] = 1;
    }
  }

  const distance = new Int16Array(ROOM_AREA);
  distance.fill(-1);
  const parent = new Int16Array(ROOM_AREA);
  parent.fill(-1);
  const queue = new Int16Array(ROOM_AREA);
  const retainedMask = new Uint8Array(ROOM_AREA);
  let queueHead = 0;
  let queueTail = 0;

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
      (candidateDistance === bestDistance &&
        bestIndex >= 0 &&
        index >= bestIndex)
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

  for (const exit of getExitCoordinates(terrain)) {
    for (let dy = -EXIT_SINK_RANGE; dy <= EXIT_SINK_RANGE; dy++) {
      for (let dx = -EXIT_SINK_RANGE; dx <= EXIT_SINK_RANGE; dx++) {
        const x = exit.x + dx;
        const y = exit.y + dy;

        if (!isInsideRoom(x, y) || terrain.get(x, y) === TERRAIN_MASK_WALL) {
          continue;
        }

        sinkMask[toRoomIndex(x, y)] = 1;
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

/**
 * Removes min-cut components that cannot be reached from the retained civil
 * road network without leaving the original inside area. This is the same
 * practical distinction the old planner made when it skipped a cut whose
 * rampart path search was incomplete.
 *
 * After removal, inside/outside masks are recomputed from exits so ranged
 * danger across natural walls is classified against the defense that will
 * actually be built.
 */
function discardInaccessibleRampartComponents(
  terrain: RoomTerrain,
  rampartPlan: OuterRampartPlan,
  civilRoads: readonly RoomCoordinate[],
  blockedMask: Uint8Array,
  structures: readonly PlannedStructure[],
): OuterRampartPlan | undefined {
  const components = findRampartComponents(rampartPlan.rampartMask);

  if (components.length === 0) {
    return;
  }

  const starts = civilRoads.filter(({ x, y }) => {
    const index = toRoomIndex(x, y);
    return !!(
      (rampartPlan.insideMask[index] || rampartPlan.rampartMask[index]) &&
      !blockedMask[index]
    );
  });

  if (starts.length === 0) {
    return;
  }

  const { distances } = floodFill(terrain, starts, (x, y) => {
    const index = toRoomIndex(x, y);
    return !!(
      (rampartPlan.insideMask[index] || rampartPlan.rampartMask[index]) &&
      !blockedMask[index]
    );
  });
  const keptMask = new Uint8Array(ROOM_AREA);
  let keptComponentCount = 0;

  for (const component of components) {
    if (!component.tileIndices.some((index) => distances[index] >= 0)) {
      continue;
    }

    keptComponentCount++;

    for (const index of component.tileIndices) {
      keptMask[index] = 1;
    }
  }

  if (keptComponentCount === 0) {
    return;
  }

  if (keptComponentCount === components.length) {
    return rampartPlan;
  }

  const filteredPlan = rebuildRampartPlan(terrain, keptMask);

  // Discarding a natural-wall island must not open an actual protected
  // structure to pathing from an exit. If it does, the component was not merely
  // redundant and this final-defense attempt is invalid.
  for (const structure of structures) {
    if (!isProtectedStructure(structure)) {
      continue;
    }

    const { x, y } = structure.coordinate;

    if (filteredPlan.outsideMask[toRoomIndex(x, y)]) {
      return;
    }
  }

  return filteredPlan;
}

function rebuildRampartPlan(
  terrain: RoomTerrain,
  rampartMask: Uint8Array,
): OuterRampartPlan {
  const exits = getExitCoordinates(terrain).filter(
    ({ x, y }) => !rampartMask[toRoomIndex(x, y)],
  );
  const { distances } = floodFill(
    terrain,
    exits,
    (x, y) => !rampartMask[toRoomIndex(x, y)],
  );
  const outsideMask = new Uint8Array(ROOM_AREA);
  const insideMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index);

    if (terrain.get(x, y) === TERRAIN_MASK_WALL || rampartMask[index]) {
      continue;
    }

    if (distances[index] >= 0) {
      outsideMask[index] = 1;
    } else {
      insideMask[index] = 1;
    }
  }

  return {
    ramparts: coordinatesFromMask(rampartMask),
    rampartMask,
    insideMask,
    outsideMask,
  };
}

function getExitCoordinates(terrain: RoomTerrain): RoomCoordinate[] {
  const exits: RoomCoordinate[] = [];

  for (let x = 0; x < ROOM_SIZE; x++) {
    for (const y of [0, ROOM_SIZE - 1]) {
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exits.push({ x, y });
      }
    }
  }

  for (let y = 1; y < ROOM_SIZE - 1; y++) {
    for (const x of [0, ROOM_SIZE - 1]) {
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exits.push({ x, y });
      }
    }
  }

  return exits;
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
  const additions: RoomCoordinate[] = [];

  if (
    !connectRampartComponents(
      terrain,
      rampartPlan,
      blockedMask,
      roadMask,
      additions,
    )
  ) {
    return;
  }

  extendRoadsToSafeRepairTiles(
    terrain,
    rampartPlan,
    blockedMask,
    roadMask,
    additions,
  );

  return additions;
}

function connectRampartComponents(
  terrain: RoomTerrain,
  rampartPlan: OuterRampartPlan,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
  additions: RoomCoordinate[],
): boolean {
  const components = findRampartComponents(rampartPlan.rampartMask);
  const remainingComponents = components.map((_, index) => index);

  while (remainingComponents.length > 0) {
    const distances = buildDefenseRoadDistanceMap(
      terrain,
      rampartPlan,
      blockedMask,
      roadMask,
    );
    const target = findClosestRampartTarget(
      components,
      remainingComponents,
      distances,
    );

    if (!target) {
      return false;
    }

    const path = traceDefenseRoadPath(
      terrain,
      target.coordinate,
      distances,
      roadMask,
    );

    if (!path) {
      return false;
    }

    addRoadPath(path, roadMask, additions);
    remainingComponents.splice(
      remainingComponents.indexOf(target.componentIndex),
      1,
    );
  }

  return true;
}

/**
 * A component connection alone may leave long sections of the wall without a
 * practical repair position. Extend the final road network to safe repair
 * tiles before considering dangerous repair stations or moving the min-cut.
 */
function extendRoadsToSafeRepairTiles(
  terrain: RoomTerrain,
  rampartPlan: OuterRampartPlan,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
  additions: RoomCoordinate[],
): void {
  const safeRepairMask =
    classifyDefensiveTiles(rampartPlan).safeRepairCandidateMask;

  while (true) {
    const uncovered = getRampartsWithoutAccessibleSafeRepair(
      rampartPlan.ramparts,
      safeRepairMask,
      blockedMask,
      roadMask,
    );

    if (uncovered.size === 0) {
      return;
    }

    const distances = buildDefenseRoadDistanceMap(
      terrain,
      rampartPlan,
      blockedMask,
      roadMask,
    );
    const target = findBestSafeRepairRoadTarget(
      safeRepairMask,
      blockedMask,
      uncovered,
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

    if (!path || path.length === 0) {
      return;
    }

    addRoadPath(path, roadMask, additions);
  }
}

function buildDefenseRoadDistanceMap(
  terrain: RoomTerrain,
  rampartPlan: OuterRampartPlan,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    coordinatesFromMask(roadMask),
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
}

function findBestSafeRepairRoadTarget(
  safeRepairMask: Uint8Array,
  blockedMask: Uint8Array,
  uncoveredRamparts: ReadonlySet<number>,
  distances: Int32Array,
): SafeRepairRoadTarget | undefined {
  let best: SafeRepairRoadTarget | undefined;

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!safeRepairMask[index] || blockedMask[index] || distances[index] < 0) {
      continue;
    }

    const coordinate = fromRoomIndex(index);
    let coverage = 0;

    forEachCoordinateInRange(coordinate, REPAIR_RANGE, (x, y) => {
      if (uncoveredRamparts.has(toRoomIndex(x, y))) {
        coverage++;
      }
    });

    if (coverage === 0) {
      continue;
    }

    const distance = distances[index];

    if (
      best &&
      (distance > best.distance ||
        (distance === best.distance && coverage < best.coverage) ||
        (distance === best.distance &&
          coverage === best.coverage &&
          index >= toRoomIndex(best.coordinate.x, best.coordinate.y)))
    ) {
      continue;
    }

    best = { coordinate, distance, coverage };
  }

  return best;
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
  const uncovered = getRampartsWithoutAccessibleSafeRepair(
    rampartPlan.ramparts,
    defensiveTiles.safeRepairCandidateMask,
    blockedMask,
    roadMask,
  );
  const repairRamparts: RoomCoordinate[] = [];

  // Prefer an already-roaded dangerous tile, then a tile adjacent to a road.
  // Among equally accessible candidates, cover as many repair gaps as possible.
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

  return {
    ramparts: repairRamparts,
    unresolvedRamparts: [...uncovered].map(fromRoomIndex),
  };
}

function getRampartsWithoutAccessibleSafeRepair(
  ramparts: readonly RoomCoordinate[],
  safeRepairMask: Uint8Array,
  blockedMask: Uint8Array,
  roadMask: Uint8Array,
): Set<number> {
  const uncovered = new Set<number>();

  for (const rampart of ramparts) {
    if (
      !hasAccessibleSafeRepairTile(
        rampart,
        safeRepairMask,
        blockedMask,
        roadMask,
      )
    ) {
      uncovered.add(toRoomIndex(rampart.x, rampart.y));
    }
  }

  return uncovered;
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

function collectDangerOverlayRamparts(
  structures: readonly PlannedStructure[],
  roads: readonly RoomCoordinate[],
  dangerousMask: Uint8Array,
): RoomCoordinate[] {
  const rampartMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    const { x, y } = structure.coordinate;
    const index = toRoomIndex(x, y);

    if (dangerousMask[index]) {
      rampartMask[index] = 1;
    }
  }

  for (const { x, y } of roads) {
    const index = toRoomIndex(x, y);

    if (dangerousMask[index]) {
      rampartMask[index] = 1;
    }
  }

  return coordinatesFromMask(rampartMask);
}

function assembleFinalStructures(
  provisionalStructures: readonly PlannedStructure[],
  baseStructures: readonly PlannedStructure[],
  civilRoads: readonly RoomCoordinate[],
  defenseRoads: readonly RoomCoordinate[],
  outerRamparts: readonly RoomCoordinate[],
  repairRamparts: readonly RoomCoordinate[],
  dangerRamparts: readonly RoomCoordinate[],
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

  for (const rampart of [
    ...outerRamparts,
    ...repairRamparts,
    ...dangerRamparts,
  ]) {
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
