import { floodFill } from "../../world/map/floodFill";
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  ROOM_SIZE,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { PlannedStructure } from "./basePlan";
import { classifyDefensiveTiles } from "./classifyDefensiveTiles";
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import type { CorePlan } from "./findCorePlans";
import type { OuterRampartPlan } from "./planOuterRamparts";
import type { StructureSlotPlan } from "./planStructureSlots";

const NUM_TOWERS = 6;
const REQUIRED_NON_TOWER_SLOTS = 64;

interface TowerCandidate {
  readonly coordinate: RoomCoordinate;
  readonly roomIndex: number;
  readonly usesStructureSlot: boolean;
  readonly usesSpawnSlot: boolean;
}

export function planTowers(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  slotPlan: StructureSlotPlan,
  structures: readonly PlannedStructure[],
): RoomCoordinate[] | undefined {
  if (slotPlan.slots.length < REQUIRED_NON_TOWER_SLOTS) {
    return;
  }

  const topology = rebuildFinalRampartPlan(terrain, structures);

  if (!topology || topology.ramparts.length === 0) {
    return;
  }

  const dangerousMask = classifyDefensiveTiles(topology).dangerousMask;
  const roadMask = buildRoadMask(structures);
  const spawnSlotCount = countSpawnSlots(slotPlan, roadMask);

  if (spawnSlotCount < 2) {
    return;
  }

  const candidates = collectTowerCandidates(
    terrain,
    controller,
    sources,
    minerals,
    controllerArea,
    corePlan,
    slotPlan,
    structures,
    topology,
    dangerousMask,
    roadMask,
  );
  const maxSlotTowers = Math.max(
    0,
    slotPlan.slots.length - REQUIRED_NON_TOWER_SLOTS,
  );
  const selected = selectTowerCandidates(
    candidates,
    topology.ramparts,
    maxSlotTowers,
    spawnSlotCount - 2,
  );

  if (!selected || selected.length !== NUM_TOWERS) {
    return;
  }

  return selected.map(({ coordinate }) => coordinate);
}

function collectTowerCandidates(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  slotPlan: StructureSlotPlan,
  structures: readonly PlannedStructure[],
  topology: OuterRampartPlan,
  dangerousMask: Uint8Array,
  roadMask: Uint8Array,
): TowerCandidate[] {
  const slotMask = new Uint8Array(ROOM_AREA);

  for (const { coordinate } of slotPlan.slots) {
    slotMask[toRoomIndex(coordinate.x, coordinate.y)] = 1;
  }

  const rampartMask = new Uint8Array(ROOM_AREA);
  const occupiedMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    const { x, y } = structure.coordinate;
    const index = toRoomIndex(x, y);

    if (structure.structureType === STRUCTURE_ROAD) {
      continue;
    }

    if (structure.structureType === STRUCTURE_RAMPART) {
      rampartMask[index] = 1;
      continue;
    }

    // Slot extensions are temporary defense-finalization placeholders. Towers
    // intentionally get priority over them before the real slot assignment.
    if (structure.structureType === STRUCTURE_EXTENSION && slotMask[index]) {
      continue;
    }

    occupiedMask[index] = 1;
  }

  const reservedOpenMask = buildReservedOpenTileMask(controllerArea, corePlan);
  const roomObjectMask = new Uint8Array(ROOM_AREA);
  roomObjectMask[toRoomIndex(controller.pos.x, controller.pos.y)] = 1;

  for (const { pos } of sources) {
    roomObjectMask[toRoomIndex(pos.x, pos.y)] = 1;
  }

  for (const { pos } of minerals) {
    roomObjectMask[toRoomIndex(pos.x, pos.y)] = 1;
  }

  const seen = new Uint8Array(ROOM_AREA);
  const candidates: TowerCandidate[] = [];

  for (let roadIndex = 0; roadIndex < ROOM_AREA; roadIndex++) {
    if (!roadMask[roadIndex] || !topology.insideMask[roadIndex]) {
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

      if (seen[index]) {
        continue;
      }

      seen[index] = 1;

      if (!topology.insideMask[index]) {
        continue;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      if (
        roadMask[index] ||
        occupiedMask[index] ||
        reservedOpenMask[index] ||
        roomObjectMask[index]
      ) {
        continue;
      }

      // Defense is already finalized. A dangerous tile is only valid if the
      // defense pass already placed an overlapping rampart there for a slot.
      if (dangerousMask[index] && !rampartMask[index]) {
        continue;
      }

      const usesStructureSlot = slotMask[index] === 1;

      candidates.push({
        coordinate: { x, y },
        roomIndex: index,
        usesStructureSlot,
        usesSpawnSlot:
          usesStructureSlot && countAdjacentRoads({ x, y }, roadMask) >= 2,
      });
    }
  }

  return candidates;
}

function buildRoadMask(structures: readonly PlannedStructure[]): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_ROAD) {
      continue;
    }

    const { x, y } = structure.coordinate;
    roadMask[toRoomIndex(x, y)] = 1;
  }

  return roadMask;
}

function countSpawnSlots(
  slotPlan: StructureSlotPlan,
  roadMask: Uint8Array,
): number {
  let count = 0;

  for (const { coordinate } of slotPlan.slots) {
    if (countAdjacentRoads(coordinate, roadMask) >= 2) {
      count++;
    }
  }

  return count;
}

function countAdjacentRoads(
  coordinate: RoomCoordinate,
  roadMask: Uint8Array,
): number {
  let count = 0;

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = coordinate.x + offset.x;
    const y = coordinate.y + offset.y;

    if (!isInsideRoom(x, y)) {
      continue;
    }

    if (roadMask[toRoomIndex(x, y)]) {
      count++;
    }
  }

  return count;
}

function buildReservedOpenTileMask(
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);
  const block = ({ x, y }: RoomCoordinate): void => {
    mask[toRoomIndex(x, y)] = 1;
  };

  block(corePlan.manager);
  corePlan.parking.forEach(block);

  const lateStructureIndices = new Set([
    toRoomIndex(corePlan.factory.x, corePlan.factory.y),
    toRoomIndex(corePlan.powerSpawn.x, corePlan.powerSpawn.y),
  ]);
  const { left, middle, right } = controllerArea.upgradeChains;

  for (const chain of [left, middle, right]) {
    const isLateStructureChain = chain.some(({ x, y }) =>
      lateStructureIndices.has(toRoomIndex(x, y)),
    );

    if (!isLateStructureChain) {
      block(chain[0]);
    }
  }

  return mask;
}

function selectTowerCandidates(
  candidates: TowerCandidate[],
  ramparts: readonly RoomCoordinate[],
  maxSlotTowers: number,
  maxSpawnSlotTowers: number,
): TowerCandidate[] | undefined {
  if (candidates.length < NUM_TOWERS || ramparts.length === 0) {
    return;
  }

  const remaining = [...candidates];
  const selected: TowerCandidate[] = [];
  let selectedSlotTowers = 0;
  let selectedSpawnSlotTowers = 0;

  const firstTower = getMinCandidate(
    getEligibleCandidates(
      remaining,
      selectedSlotTowers,
      maxSlotTowers,
      selectedSpawnSlotTowers,
      maxSpawnSlotTowers,
    ),
    (candidate) => getAverageRange(candidate.coordinate, ramparts),
  );

  if (!firstTower) {
    return;
  }

  removeCandidate(remaining, firstTower);
  selected.push(firstTower);
  selectedSlotTowers += firstTower.usesStructureSlot ? 1 : 0;
  selectedSpawnSlotTowers += firstTower.usesSpawnSlot ? 1 : 0;

  while (selected.length < NUM_TOWERS) {
    let weakestRampart: RoomCoordinate | undefined;
    let minDamage = Infinity;

    for (const rampart of ramparts) {
      let damage = 0;

      for (const tower of selected) {
        damage += getTowerDamage(getRange(tower.coordinate, rampart));
      }

      if (damage < minDamage) {
        minDamage = damage;
        weakestRampart = rampart;
      }
    }

    if (!weakestRampart) {
      return;
    }

    const eligible = getEligibleCandidates(
      remaining,
      selectedSlotTowers,
      maxSlotTowers,
      selectedSpawnSlotTowers,
      maxSpawnSlotTowers,
    );

    if (eligible.length === 0) {
      return;
    }

    let minRange = Infinity;

    for (const candidate of eligible) {
      minRange = Math.min(
        minRange,
        getRange(candidate.coordinate, weakestRampart),
      );
    }

    const nearWeakest = eligible.filter(
      (candidate) =>
        getRange(candidate.coordinate, weakestRampart) <= minRange + 1,
    );
    const tower = getMinCandidate(nearWeakest, (candidate) =>
      getAverageRange(candidate.coordinate, ramparts),
    );

    if (!tower) {
      return;
    }

    removeCandidate(remaining, tower);
    selected.push(tower);
    selectedSlotTowers += tower.usesStructureSlot ? 1 : 0;
    selectedSpawnSlotTowers += tower.usesSpawnSlot ? 1 : 0;
  }

  return selected;
}

function getEligibleCandidates(
  candidates: readonly TowerCandidate[],
  selectedSlotTowers: number,
  maxSlotTowers: number,
  selectedSpawnSlotTowers: number,
  maxSpawnSlotTowers: number,
): TowerCandidate[] {
  return candidates.filter((candidate) => {
    if (
      candidate.usesStructureSlot &&
      selectedSlotTowers >= maxSlotTowers
    ) {
      return false;
    }

    if (
      candidate.usesSpawnSlot &&
      selectedSpawnSlotTowers >= maxSpawnSlotTowers
    ) {
      return false;
    }

    return true;
  });
}

function getMinCandidate(
  candidates: readonly TowerCandidate[],
  getScore: (candidate: TowerCandidate) => number,
): TowerCandidate | undefined {
  let best: TowerCandidate | undefined;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const score = getScore(candidate);

    if (score > bestScore) {
      continue;
    }

    if (score === bestScore && best) {
      if (candidate.usesStructureSlot !== best.usesStructureSlot) {
        if (candidate.usesStructureSlot) {
          continue;
        }
      } else if (candidate.roomIndex >= best.roomIndex) {
        continue;
      }
    }

    best = candidate;
    bestScore = score;
  }

  return best;
}

function removeCandidate(
  candidates: TowerCandidate[],
  target: TowerCandidate,
): void {
  const index = candidates.indexOf(target);

  if (index >= 0) {
    candidates.splice(index, 1);
  }
}

function rebuildFinalRampartPlan(
  terrain: RoomTerrain,
  structures: readonly PlannedStructure[],
): OuterRampartPlan | undefined {
  const allRampartMask = new Uint8Array(ROOM_AREA);

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_RAMPART) {
      continue;
    }

    const { x, y } = structure.coordinate;
    allRampartMask[toRoomIndex(x, y)] = 1;
  }

  const outsideWithAllRamparts = buildOutsideMask(terrain, allRampartMask);
  const outerRampartMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!allRampartMask[index]) {
      continue;
    }

    const coordinate = fromRoomIndex(index);

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = coordinate.x + offset.x;
      const y = coordinate.y + offset.y;

      if (!isInsideRoom(x, y)) {
        continue;
      }

      if (outsideWithAllRamparts[toRoomIndex(x, y)]) {
        outerRampartMask[index] = 1;
        break;
      }
    }
  }

  const ramparts = coordinatesFromMask(outerRampartMask);

  if (ramparts.length === 0) {
    return;
  }

  const outsideMask = buildOutsideMask(terrain, outerRampartMask);
  const insideMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index);

    if (terrain.get(x, y) === TERRAIN_MASK_WALL || outerRampartMask[index]) {
      continue;
    }

    if (!outsideMask[index]) {
      insideMask[index] = 1;
    }
  }

  return {
    ramparts,
    rampartMask: outerRampartMask,
    insideMask,
    outsideMask,
  };
}

function buildOutsideMask(
  terrain: RoomTerrain,
  rampartMask: Uint8Array,
): Uint8Array {
  const exits = getExitCoordinates(terrain.filter(
    ({ x, y }) => !rampartMask[toRoomIndex(x, y)],
  );
  const { distances } = floodFill(
    terrain,
    exits,
    (x, y) => !rampartMask[toRoomIndex(x, y)],
  );
  const outsideMask = new Uint8Array(ROOM_AREA);

  for (let index = 0; index < ROOM_AREA; index++) {
    if (distances[index] >= 0) {
      outsideMask[index] = 1;
    }
  }

  return outsideMask;
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

function coordinatesFromMask(mask: Uint8Array): RoomCoordinate[] {
  const coordinates: RoomCoordinate[] = [];

  for (let index = 0; index < ROOM_AREA; index++) {
    if (mask[index]) {
      coordinates.push(fromRoomIndex(index));
    }
  }

  return coordinates;
}

function getAverageRange(
  coordinate: RoomCoordinate,
  targets: readonly RoomCoordinate[],
): number {
  let total = 0;

  for (const target of targets) {
    total += getRange(coordinate, target);
  }

  return total / targets.length;
}

function getTowerDamage(range: number): number {
  if (range <= TOWER_OPTIMAL_RANGE) {
    return TOWER_POWER_ATTACK;
  }

  const clampedRange = Math.min(
    range,
    TOWER_FALLOFF_RANGE,
  );
  const falloff =
    (TOWER_FALLOFF * (clampedRange - TOWER_OPTIMAL_RANGE)) /
    (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);

  return TOWER_POWER_ATTACK * (1 - falloff);
}
