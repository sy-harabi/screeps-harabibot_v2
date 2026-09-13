import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate";
import {
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  toRoomIndex,
} from "../../world/map/roomGrid";
import type { PlannedStructure, PlannedStructureTag } from "./basePlan";
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates";
import type { CorePlan } from "./findCorePlans";
import type { LabPlan } from "./planLabs";
import type { OuterRampartPlan } from "./planOuterRamparts";
import type { RegionBoundaryRoadPlan } from "./planRegionBoundaryRoads";
import type { ResourceTreePlan } from "./planResourceTree";
import type { StructureSlot, StructureSlotPlan } from "./planStructureSlots";

const NUM_ADDITIONAL_SPAWNS = 2;
const NUM_TOWERS = 6;
const NUM_EXTENSIONS = 60;

interface RankedSlot {
  readonly slot: StructureSlot;
  readonly lateChain: boolean;
  readonly roomIndex: number;
}

interface AssignedSlotStructures {
  readonly spawns: RankedSlot[];
  readonly towers: RankedSlot[];
  readonly observer: RankedSlot;
  readonly nuker: RankedSlot;
  readonly extensions: RankedSlot[];
}

export function finalizeBasePlanStructures(
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  outerRampartPlan: OuterRampartPlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  slotPlan: StructureSlotPlan,
  visual: RoomVisual,
): PlannedStructure[] | undefined {
  const assigned = assignStructureSlots(
    controllerArea,
    corePlan,
    resourceTree,
    outerRampartPlan,
    boundaryRoadPlan,
    labPlan,
    slotPlan,
  );

  if (!assigned) {
    return;
  }

  visualizeAssignedSlots(assigned, visual);

  const structures: PlannedStructure[] = [];
  const seen = new Set<string>();

  const addStructure = (
    structureType: BuildableStructureConstant,
    coordinate: RoomCoordinate,
    rcl: number,
    tag?: PlannedStructureTag,
  ): void => {
    const key = `${structureType}:${coordinate.x}:${coordinate.y}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    structures.push({ structureType, coordinate, rcl, tag });
  };

  addStructure(
    STRUCTURE_SPAWN,
    corePlan.firstSpawn,
    getStructureRcl(STRUCTURE_SPAWN, 0),
  );
  addStructure(
    STRUCTURE_STORAGE,
    controllerArea.storage,
    getStructureRcl(STRUCTURE_STORAGE, 0),
  );
  addStructure(
    STRUCTURE_TERMINAL,
    corePlan.terminal,
    getStructureRcl(STRUCTURE_TERMINAL, 0),
  );
  addStructure(
    STRUCTURE_FACTORY,
    corePlan.factory,
    getStructureRcl(STRUCTURE_FACTORY, 0),
  );
  addStructure(
    STRUCTURE_POWER_SPAWN,
    corePlan.powerSpawn,
    getStructureRcl(STRUCTURE_POWER_SPAWN, 0),
  );
  addStructure(
    STRUCTURE_LINK,
    corePlan.link,
    getStructureRcl(STRUCTURE_LINK, 0),
    { kind: "storage" },
  );

  let linkOrdinal = 1;
  let containerOrdinal = 0;

  for (const branch of resourceTree.branches) {
    const tag = getResourceTag(branch.targetId, sources, minerals);

    addStructure(
      STRUCTURE_CONTAINER,
      branch.container,
      getStructureRcl(STRUCTURE_CONTAINER, containerOrdinal++),
      tag,
    );

    if (branch.link) {
      addStructure(
        STRUCTURE_LINK,
        branch.link,
        getStructureRcl(STRUCTURE_LINK, linkOrdinal++),
        tag,
      );
    }
  }

  minerals.forEach((mineral, index) =>
    addStructure(
      STRUCTURE_EXTRACTOR,
      mineral.pos,
      getStructureRcl(STRUCTURE_EXTRACTOR, index),
      { kind: "mineral", id: mineral.id },
    ),
  );

  const labs = [...labPlan.inputLabs, ...labPlan.outputLabs];
  labs.forEach((coordinate, index) =>
    addStructure(
      STRUCTURE_LAB,
      coordinate,
      getStructureRcl(STRUCTURE_LAB, index),
    ),
  );

  assigned.spawns.forEach((rankedSlot, index) =>
    addStructure(
      STRUCTURE_SPAWN,
      rankedSlot.slot.coordinate,
      getStructureRcl(STRUCTURE_SPAWN, index + 1),
    ),
  );

  [...assigned.towers]
    .sort(compareRankedSlots)
    .forEach((rankedSlot, index) =>
      addStructure(
        STRUCTURE_TOWER,
        rankedSlot.slot.coordinate,
        getStructureRcl(STRUCTURE_TOWER, index),
      ),
    );

  addStructure(
    STRUCTURE_OBSERVER,
    assigned.observer.slot.coordinate,
    getStructureRcl(STRUCTURE_OBSERVER, 0),
  );
  addStructure(
    STRUCTURE_NUKER,
    assigned.nuker.slot.coordinate,
    getStructureRcl(STRUCTURE_NUKER, 0),
  );

  assigned.extensions.forEach((rankedSlot, index) =>
    addStructure(
      STRUCTURE_EXTENSION,
      rankedSlot.slot.coordinate,
      getStructureRcl(STRUCTURE_EXTENSION, index),
    ),
  );

  const roads = [
    ...corePlan.roads,
    ...resourceTree.roads,
    ...boundaryRoadPlan.roads,
    ...labPlan.serviceRoads,
    ...slotPlan.roads,
  ];

  roads.forEach((coordinate) =>
    addStructure(
      STRUCTURE_ROAD,
      coordinate,
      getStructureRcl(STRUCTURE_ROAD, 0),
    ),
  );

  outerRampartPlan.ramparts.forEach((coordinate) =>
    addStructure(
      STRUCTURE_RAMPART,
      coordinate,
      getStructureRcl(STRUCTURE_RAMPART, 0),
    ),
  );

  return structures;
}

function assignStructureSlots(
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  outerRampartPlan: OuterRampartPlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  slotPlan: StructureSlotPlan,
): AssignedSlotStructures | undefined {
  const slots = rankSlots(slotPlan.slots, controllerArea, corePlan);
  const roadMask = buildRoadMask(
    corePlan,
    resourceTree,
    boundaryRoadPlan,
    labPlan,
    slotPlan,
  );

  const spawns: RankedSlot[] = [];

  for (let i = 0; i < NUM_ADDITIONAL_SPAWNS; i++) {
    const spawn = takeFirstMatching(
      slots,
      ({ slot }) => countAdjacentRoads(slot.coordinate, roadMask) >= 2,
    );

    if (!spawn) {
      return;
    }

    spawns.push(spawn);
  }

  const towers = selectTowerSlots(slots, outerRampartPlan.ramparts);

  if (!towers || towers.length !== NUM_TOWERS) {
    return;
  }

  const observer = slots.pop();
  const nuker = slots.pop();

  if (!observer || !nuker || slots.length < NUM_EXTENSIONS) {
    return;
  }

  const extensions = slots.slice(0, NUM_EXTENSIONS);

  return { spawns, towers, observer, nuker, extensions };
}

function rankSlots(
  slots: readonly StructureSlot[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): RankedSlot[] {
  const lateChainMask = buildLateChainMask(controllerArea, corePlan);

  return slots
    .map((slot) => {
      const roomIndex = toRoomIndex(slot.coordinate.x, slot.coordinate.y);

      return {
        slot,
        lateChain: lateChainMask[roomIndex] === 1,
        roomIndex,
      };
    })
    .sort(compareRankedSlots);
}

function compareRankedSlots(left: RankedSlot, right: RankedSlot): number {
  if (left.lateChain !== right.lateChain) {
    return left.lateChain ? 1 : -1;
  }

  return (
    left.slot.serviceDistance - right.slot.serviceDistance ||
    left.roomIndex - right.roomIndex
  );
}

function buildLateChainMask(
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA);
  const lateStructureIndices = new Set([
    toRoomIndex(corePlan.factory.x, corePlan.factory.y),
    toRoomIndex(corePlan.powerSpawn.x, corePlan.powerSpawn.y),
  ]);

  for (const chain of Object.values(controllerArea.upgradeChains)) {
    const isLateChain = chain.some(({ x, y }) =>
      lateStructureIndices.has(toRoomIndex(x, y)),
    );

    if (!isLateChain) {
      continue;
    }

    for (const { x, y } of chain) {
      mask[toRoomIndex(x, y)] = 1;
    }
  }

  return mask;
}

function buildRoadMask(
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  slotPlan: StructureSlotPlan,
): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA);

  for (const { x, y } of [
    ...corePlan.roads,
    ...resourceTree.roads,
    ...boundaryRoadPlan.roads,
    ...labPlan.serviceRoads,
    ...slotPlan.roads,
  ]) {
    roadMask[toRoomIndex(x, y)] = 1;
  }

  return roadMask;
}

function countAdjacentRoads(
  coordinate: RoomCoordinate,
  roadMask: Uint8Array,
): number {
  let count = 0;

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = coordinate.x + offset.x;
    const y = coordinate.y + offset.y;

    if (x < 0 || x >= 50 || y < 0 || y >= 50) {
      continue;
    }

    if (roadMask[toRoomIndex(x, y)]) {
      count++;
    }
  }

  return count;
}

function takeFirstMatching(
  slots: RankedSlot[],
  predicate: (slot: RankedSlot) => boolean,
): RankedSlot | undefined {
  const index = slots.findIndex(predicate);

  if (index < 0) {
    return;
  }

  return slots.splice(index, 1)[0];
}

function selectTowerSlots(
  slots: RankedSlot[],
  ramparts: readonly RoomCoordinate[],
): RankedSlot[] | undefined {
  if (ramparts.length === 0 || slots.length < NUM_TOWERS) {
    return;
  }

  const selected: RankedSlot[] = [];

  const firstTower = getMinSlot(slots, ({ slot }) =>
    getAverageRange(slot.coordinate, ramparts),
  );

  if (!firstTower) {
    return;
  }

  removeSlot(slots, firstTower);
  selected.push(firstTower);

  while (selected.length < NUM_TOWERS) {
    if (slots.length === 0) {
      return;
    }

    let weakestRampart: RoomCoordinate | undefined;
    let minDamage = Infinity;

    for (const rampart of ramparts) {
      let damage = 0;

      for (const tower of selected) {
        damage += getTowerDamage(getRange(tower.slot.coordinate, rampart));
      }

      if (damage < minDamage) {
        minDamage = damage;
        weakestRampart = rampart;
      }
    }

    if (!weakestRampart) {
      return;
    }

    let minRange = Infinity;

    for (const candidate of slots) {
      minRange = Math.min(
        minRange,
        getRange(candidate.slot.coordinate, weakestRampart),
      );
    }

    const candidates = slots.filter(
      ({ slot }) => getRange(slot.coordinate, weakestRampart) <= minRange + 1,
    );
    const tower = getMinSlot(candidates, ({ slot }) =>
      getAverageRange(slot.coordinate, ramparts),
    );

    if (!tower) {
      return;
    }

    removeSlot(slots, tower);
    selected.push(tower);
  }

  return selected;
}

function getMinSlot(
  slots: readonly RankedSlot[],
  getScore: (slot: RankedSlot) => number,
): RankedSlot | undefined {
  let best: RankedSlot | undefined;
  let bestScore = Infinity;

  for (const slot of slots) {
    const score = getScore(slot);

    if (score < bestScore) {
      best = slot;
      bestScore = score;
    }
  }

  return best;
}

function removeSlot(slots: RankedSlot[], target: RankedSlot): void {
  const index = slots.indexOf(target);

  if (index >= 0) {
    slots.splice(index, 1);
  }
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

  const clampedRange = Math.min(range, TOWER_FALLOFF_RANGE);
  const falloff =
    (TOWER_FALLOFF * (clampedRange - TOWER_OPTIMAL_RANGE)) /
    (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE);

  return TOWER_POWER_ATTACK * (1 - falloff);
}

function getResourceTag(
  targetId: Id<Source> | Id<Mineral>,
  sources: readonly Source[],
  minerals: readonly Mineral[],
): PlannedStructureTag | undefined {
  const source = sources.find(({ id }) => id === targetId);

  if (source) {
    return { kind: "source", id: source.id };
  }

  const mineral = minerals.find(({ id }) => id === targetId);

  if (mineral) {
    return { kind: "mineral", id: mineral.id };
  }

  return;
}

function getStructureRcl(
  structureType: BuildableStructureConstant,
  ordinal: number,
): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as Record<number, number>;

  for (let rcl = 1; rcl <= 8; rcl++) {
    if ((limits[rcl] ?? 0) > ordinal) {
      return rcl;
    }
  }

  throw new Error(
    `No RCL available for ${structureType} structure ordinal ${ordinal}`,
  );
}

function visualizeAssignedSlots(
  assigned: AssignedSlotStructures,
  visual: RoomVisual,
): void {
  assigned.spawns.forEach(({ slot }) =>
    visual.structure(slot.coordinate.x, slot.coordinate.y, STRUCTURE_SPAWN),
  );
  assigned.towers.forEach(({ slot }) =>
    visual.structure(slot.coordinate.x, slot.coordinate.y, STRUCTURE_TOWER),
  );
  visual.structure(
    assigned.observer.slot.coordinate.x,
    assigned.observer.slot.coordinate.y,
    STRUCTURE_OBSERVER,
  );
  visual.structure(
    assigned.nuker.slot.coordinate.x,
    assigned.nuker.slot.coordinate.y,
    STRUCTURE_NUKER,
  );
  assigned.extensions.forEach(({ slot }) =>
    visual.structure(slot.coordinate.x, slot.coordinate.y, STRUCTURE_EXTENSION),
  );
}
