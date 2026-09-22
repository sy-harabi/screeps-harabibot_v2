import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { NEIGHBOR_OFFSETS, ROOM_AREA, toRoomIndex } from "../../world/map/roomGrid"
import { assignRoadRcls } from "./assignRoadRcls"
import type { PlannedStructure, PlannedStructureTag } from "./basePlan"
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates"
import type { CorePlan } from "./findCorePlans"
import type { LabPlan } from "./planLabs"
import type { OuterRampartPlan } from "./planOuterRamparts"
import type { RegionBoundaryRoadPlan } from "./planRegionBoundaryRoads"
import type { ResourceTreePlan } from "./planResourceTree"
import { getSpawnPlanningInfo } from "./spawnPlanning"
import type { StructureSlot, StructureSlotPlan } from "./planStructureSlots"

const NUM_EXTENSIONS = 60
const NUM_OTHER_SLOT_STRUCTURES = 2
const PROVISIONAL_SLOT_RCL = 8

interface RankedSlot {
  readonly slot: StructureSlot
  readonly lateChain: boolean
  readonly roomIndex: number
}

interface AssignedSlotStructures {
  readonly spawns: RankedSlot[]
  readonly observer: RankedSlot
  readonly nuker: RankedSlot
  readonly extensions: RankedSlot[]
}

export function buildProvisionalBasePlanStructures(
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  outerRampartPlan: OuterRampartPlan,
  boundaryRoadPlan: RegionBoundaryRoadPlan,
  labPlan: LabPlan,
  slotPlan: StructureSlotPlan,
  existingSpawn?: RoomCoordinate,
): PlannedStructure[] {
  const structures: PlannedStructure[] = []
  const seen = new Set<string>()

  const addStructure = (
    structureType: BuildableStructureConstant,
    coordinate: RoomCoordinate,
    rcl: number,
    tag?: PlannedStructureTag,
  ): void => {
    const key = `${structureType}:${coordinate.x}:${coordinate.y}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    structures.push({ structureType, coordinate, rcl, tag })
  }

  addFixedStructures(sources, minerals, controllerArea, corePlan, resourceTree, labPlan, existingSpawn, addStructure)

  // Slot coordinates are temporary stand-ins only. They force final min-cut,
  // civil-road pruning, and repair-road routing to respect the complete future
  // structure footprint before towers receive priority over those slots.
  for (const { coordinate } of slotPlan.slots) {
    addStructure(STRUCTURE_EXTENSION, coordinate, PROVISIONAL_SLOT_RCL)
  }

  const roads = [
    ...corePlan.roads,
    ...resourceTree.roads,
    ...boundaryRoadPlan.roads,
    ...labPlan.serviceRoads,
    ...slotPlan.roads,
  ]

  roads.forEach((coordinate) => addStructure(STRUCTURE_ROAD, coordinate, getStructureRcl(STRUCTURE_ROAD, 0)))

  outerRampartPlan.ramparts.forEach((coordinate) =>
    addStructure(STRUCTURE_RAMPART, coordinate, getStructureRcl(STRUCTURE_RAMPART, 0)),
  )

  return structures
}

export function finalizeBasePlanStructures(
  defenseStructures: readonly PlannedStructure[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  slotPlan: StructureSlotPlan,
  towers: readonly RoomCoordinate[],
  visual: RoomVisual,
  existingSpawn?: RoomCoordinate,
): PlannedStructure[] | undefined {
  const spawnPlanning = getSpawnPlanningInfo(existingSpawn, corePlan.firstSpawn)
  const slotMask = buildSlotMask(slotPlan.slots)
  const towerMask = buildCoordinateMask(towers)
  const structures = defenseStructures.filter((structure) => {
    if (structure.structureType !== STRUCTURE_EXTENSION) {
      return true
    }

    const { x, y } = structure.coordinate
    return !slotMask[toRoomIndex(x, y)]
  })
  const roadMask = buildRoadMask(structures)
  const assigned = assignStructureSlots(
    slotPlan,
    controllerArea,
    corePlan,
    towerMask,
    roadMask,
    spawnPlanning.requiredSlotSpawns,
  )

  if (!assigned) {
    return
  }

  const seen = new Set(
    structures.map(({ structureType, coordinate }) => `${structureType}:${coordinate.x}:${coordinate.y}`),
  )

  const addStructure = (structureType: BuildableStructureConstant, coordinate: RoomCoordinate, rcl: number): void => {
    const key = `${structureType}:${coordinate.x}:${coordinate.y}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    structures.push({ structureType, coordinate, rcl })
  }

  towers.forEach((coordinate, index) =>
    addStructure(STRUCTURE_TOWER, coordinate, getStructureRcl(STRUCTURE_TOWER, index)),
  )

  assigned.spawns.forEach((rankedSlot, index) =>
    addStructure(
      STRUCTURE_SPAWN,
      rankedSlot.slot.coordinate,
      getStructureRcl(STRUCTURE_SPAWN, spawnPlanning.slotSpawnOrdinalStart + index),
    ),
  )

  addStructure(STRUCTURE_OBSERVER, assigned.observer.slot.coordinate, getStructureRcl(STRUCTURE_OBSERVER, 0))
  addStructure(STRUCTURE_NUKER, assigned.nuker.slot.coordinate, getStructureRcl(STRUCTURE_NUKER, 0))

  assigned.extensions.forEach((rankedSlot, index) =>
    addStructure(STRUCTURE_EXTENSION, rankedSlot.slot.coordinate, getStructureRcl(STRUCTURE_EXTENSION, index)),
  )

  return assignRoadRcls(structures, corePlan.roads)
}

function addFixedStructures(
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  resourceTree: ResourceTreePlan,
  labPlan: LabPlan,
  existingSpawn: RoomCoordinate | undefined,
  addStructure: (
    structureType: BuildableStructureConstant,
    coordinate: RoomCoordinate,
    rcl: number,
    tag?: PlannedStructureTag,
  ) => void,
): void {
  const spawnPlanning = getSpawnPlanningInfo(existingSpawn, corePlan.firstSpawn)

  if (existingSpawn) {
    addStructure(STRUCTURE_SPAWN, existingSpawn, getStructureRcl(STRUCTURE_SPAWN, 0))
  }

  addStructure(STRUCTURE_SPAWN, corePlan.firstSpawn, getStructureRcl(STRUCTURE_SPAWN, spawnPlanning.coreSpawnOrdinal))
  addStructure(STRUCTURE_STORAGE, controllerArea.storage, getStructureRcl(STRUCTURE_STORAGE, 0))
  addStructure(STRUCTURE_TERMINAL, corePlan.terminal, getStructureRcl(STRUCTURE_TERMINAL, 0))
  addStructure(STRUCTURE_FACTORY, corePlan.factory, getStructureRcl(STRUCTURE_FACTORY, 0))
  addStructure(STRUCTURE_POWER_SPAWN, corePlan.powerSpawn, getStructureRcl(STRUCTURE_POWER_SPAWN, 0))
  addStructure(STRUCTURE_LINK, corePlan.link, getStructureRcl(STRUCTURE_LINK, 0), { kind: "storage" })

  let linkOrdinal = 1

  for (const branch of resourceTree.branches) {
    const tag = getResourceTag(branch.targetId, sources, minerals)
    const containerRcl = tag?.kind === "mineral" ? 6 : 3

    addStructure(STRUCTURE_CONTAINER, branch.container, containerRcl, tag)

    if (branch.link) {
      addStructure(STRUCTURE_LINK, branch.link, getStructureRcl(STRUCTURE_LINK, linkOrdinal++), tag)
    }
  }

  minerals.forEach((mineral, index) =>
    addStructure(STRUCTURE_EXTRACTOR, mineral.pos, getStructureRcl(STRUCTURE_EXTRACTOR, index), {
      kind: "mineral",
      id: mineral.id,
    }),
  )

  labPlan.inputLabs.forEach((coordinate, index) =>
    addStructure(STRUCTURE_LAB, coordinate, getStructureRcl(STRUCTURE_LAB, index), { kind: "labInput" }),
  )

  labPlan.outputLabs.forEach((coordinate, index) =>
    addStructure(STRUCTURE_LAB, coordinate, getStructureRcl(STRUCTURE_LAB, index + labPlan.inputLabs.length), {
      kind: "labOutput",
    }),
  )
}

function assignStructureSlots(
  slotPlan: StructureSlotPlan,
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  towerMask: Uint8Array,
  roadMask: Uint8Array,
  requiredSlotSpawns: number,
): AssignedSlotStructures | undefined {
  const slots = rankSlots(slotPlan.slots, controllerArea, corePlan).filter(({ roomIndex }) => !towerMask[roomIndex])
  const requiredNonTowerSlots = requiredSlotSpawns + NUM_EXTENSIONS + NUM_OTHER_SLOT_STRUCTURES

  if (slots.length < requiredNonTowerSlots) {
    return
  }

  const spawns: RankedSlot[] = []

  for (let i = 0; i < requiredSlotSpawns; i++) {
    const spawn = takeFirstMatching(slots, ({ slot }) => countAdjacentRoads(slot.coordinate, roadMask) >= 2)

    if (!spawn) {
      return
    }

    spawns.push(spawn)
  }

  const observer = slots.pop()
  const nuker = slots.pop()

  if (!observer || !nuker) {
    return
  }

  const extensions = slots.slice(0, NUM_EXTENSIONS)

  if (extensions.length !== NUM_EXTENSIONS) {
    return
  }

  return { spawns, observer, nuker, extensions }
}

function rankSlots(
  slots: readonly StructureSlot[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): RankedSlot[] {
  const lateChainMask = buildLateChainMask(controllerArea, corePlan)

  return slots
    .map((slot) => {
      const roomIndex = toRoomIndex(slot.coordinate.x, slot.coordinate.y)

      return {
        slot,
        lateChain: lateChainMask[roomIndex] === 1,
        roomIndex,
      }
    })
    .sort(compareRankedSlots)
}

function compareRankedSlots(left: RankedSlot, right: RankedSlot): number {
  if (left.lateChain !== right.lateChain) {
    return left.lateChain ? 1 : -1
  }

  return left.slot.serviceDistance - right.slot.serviceDistance || left.roomIndex - right.roomIndex
}

function buildLateChainMask(controllerArea: ControllerAreaCandidate, corePlan: CorePlan): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)
  const lateStructureIndices = new Set([
    toRoomIndex(corePlan.factory.x, corePlan.factory.y),
    toRoomIndex(corePlan.powerSpawn.x, corePlan.powerSpawn.y),
  ])

  const { left, right, middle } = controllerArea.upgradeChains

  for (const chain of [left, right, middle]) {
    const isLateChain = chain.some(({ x, y }) => lateStructureIndices.has(toRoomIndex(x, y)))

    if (!isLateChain) {
      continue
    }

    for (const { x, y } of chain) {
      mask[toRoomIndex(x, y)] = 1
    }
  }

  return mask
}

function buildRoadMask(structures: readonly PlannedStructure[]): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA)

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_ROAD) {
      continue
    }

    const { x, y } = structure.coordinate
    roadMask[toRoomIndex(x, y)] = 1
  }

  return roadMask
}

function buildSlotMask(slots: readonly StructureSlot[]): Uint8Array {
  return buildCoordinateMask(slots.map(({ coordinate }) => coordinate))
}

function buildCoordinateMask(coordinates: readonly RoomCoordinate[]): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)

  for (const { x, y } of coordinates) {
    mask[toRoomIndex(x, y)] = 1
  }

  return mask
}

function countAdjacentRoads(coordinate: RoomCoordinate, roadMask: Uint8Array): number {
  let count = 0

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = coordinate.x + offset.x
    const y = coordinate.y + offset.y

    if (x < 0 || x >= 50 || y < 0 || y >= 50) {
      continue
    }

    if (roadMask[toRoomIndex(x, y)]) {
      count++
    }
  }

  return count
}

function takeFirstMatching(slots: RankedSlot[], predicate: (slot: RankedSlot) => boolean): RankedSlot | undefined {
  const index = slots.findIndex(predicate)

  if (index < 0) {
    return
  }

  return slots.splice(index, 1)[0]
}

function getResourceTag(
  targetId: Id<Source> | Id<Mineral>,
  sources: readonly Source[],
  minerals: readonly Mineral[],
): PlannedStructureTag | undefined {
  const source = sources.find(({ id }) => id === targetId)

  if (source) {
    return { kind: "source", id: source.id }
  }

  const mineral = minerals.find(({ id }) => id === targetId)

  if (mineral) {
    return { kind: "mineral", id: mineral.id }
  }

  return
}

function getStructureRcl(structureType: BuildableStructureConstant, ordinal: number): number {
  const limits = CONTROLLER_STRUCTURES[structureType] as Record<number, number>

  for (let rcl = 1; rcl <= 8; rcl++) {
    if ((limits[rcl] ?? 0) > ordinal) {
      return rcl
    }
  }

  throw new Error(`No RCL available for ${structureType} structure ordinal ${ordinal}`)
}
