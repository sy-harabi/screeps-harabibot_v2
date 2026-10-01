import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { type HarvestSourceState } from "./harvest"

export const REMOTE_BUILDER_ROLE = "remoteBuilder"

const REMOTE_BUILDER_UNIT_WORK = 3
const REMOTE_BUILDER_UNIT_CARRY = 5
const REMOTE_BUILDER_UNIT_MOVE = 4

export const REMOTE_BUILDER_TARGET_WORK = 6
export const REMOTE_BUILDER_UNIT_COST = 750

export function runRemoteBuilders(
  builders: readonly Creep[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
): void {
  for (const builder of builders) {
    if (builder.spawning) {
      continue
    }

    const sourceId = builder.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined) {
      continue
    }

    runRemoteBuilder(builder, source)
  }
}

function runRemoteBuilder(builder: Creep, source: HarvestSourceState): void {
  const energy = builder.store.getUsedCapacity(RESOURCE_ENERGY)

  const freeCapacity = builder.store.getFreeCapacity(RESOURCE_ENERGY)

  let state = builder.memory.remoteBuilderState ?? (energy > 0 ? "building" : "fetching")

  if (state === "building" && energy === 0) {
    state = "fetching"
  } else if (state === "fetching" && freeCapacity === 0) {
    state = "building"
  }

  builder.memory.remoteBuilderState = state

  if (state === "fetching") {
    runRemoteBuilderFetch(builder, source)
    return
  }

  runRemoteBuilderBuild(builder, source)
}

function runRemoteBuilderBuild(builder: Creep, source: HarvestSourceState): void {
  const target = source.remoteConstructionTarget

  if (target === undefined) {
    return
  }

  if (builder.pos.roomName !== target.roomName || !builder.pos.inRangeTo(target, 3)) {
    moveCreepByPath(builder, source.path, { reverse: true })
    return
  }

  const targetRoom = Game.rooms[target.roomName]

  if (targetRoom === undefined) {
    return
  }

  const site = targetRoom
    .lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
    .find((site) => site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD)

  if (site !== undefined) {
    builder.build(site)
  }
}

function runRemoteBuilderFetch(builder: Creep, source: HarvestSourceState): void {
  const sourcePos = source.path[source.path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (builder.pos.roomName !== sourcePos.roomName || !builder.pos.inRangeTo(sourcePos, 1)) {
    moveCreepByPath(builder, source.path)
    return
  }

  const sourceObject = Game.getObjectById(source.id)

  if (sourceObject === null) {
    return
  }

  const dropped = sourceObject.pos
    .findInRange(FIND_DROPPED_RESOURCES, 1)
    .filter((resource) => resource.resourceType === RESOURCE_ENERGY)
    .sort((a, b) => b.amount - a.amount)[0]

  if (dropped !== undefined) {
    if (!builder.pos.isNearTo(dropped)) {
      moveCreep(builder, {
        pos: dropped.pos,
        range: 1,
      })
      return
    }

    builder.pickup(dropped)
    return
  }

  const container = source.container

  if (container !== undefined && container.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    if (!builder.pos.isNearTo(container)) {
      moveCreep(builder, {
        pos: container.pos,
        range: 1,
      })
      return
    }

    builder.withdraw(container, RESOURCE_ENERGY)
  }
}

export function getRemoteBuilderCarryCapacity(builders: readonly Creep[]): number {
  let carryCapacity = 0

  for (const builder of builders) {
    if (builder.spawning) {
      continue
    }

    carryCapacity += builder.store.getCapacity(RESOURCE_ENERGY)
  }

  return carryCapacity
}

export function getRemoteBuilderCarryEquivalent(
  builders: readonly Creep[],
  source: HarvestSourceState,
  target: RoomPosition,
): number {
  let builderEnergyPerTick = 0

  const buildPathIndex = findBuildPathIndex(source.path, target)

  if (buildPathIndex === undefined) {
    return 0
  }

  const loadedPath = source.path.slice(buildPathIndex, source.path.length - 1)
  const emptyPath = source.path.slice(buildPathIndex + 1)

  for (const builder of builders) {
    if (builder.spawning) {
      continue
    }

    const workParts = builder.getActiveBodyparts(WORK)
    const carryParts = builder.getActiveBodyparts(CARRY)
    const moveParts = builder.getActiveBodyparts(MOVE)
    const carryCapacity = builder.store.getCapacity(RESOURCE_ENERGY)

    if (workParts <= 0 || moveParts <= 0 || carryCapacity <= 0) {
      continue
    }

    const loadedTravelTicks = estimatePathTravelTicks(loadedPath, moveParts, workParts + carryParts)
    const emptyTravelTicks = estimatePathTravelTicks(emptyPath, moveParts, workParts)
    const buildTicks = Math.ceil(carryCapacity / (workParts * BUILD_POWER))
    const cycleTicks = loadedTravelTicks + buildTicks + emptyTravelTicks

    if (!Number.isFinite(cycleTicks) || cycleTicks <= 0) {
      continue
    }

    builderEnergyPerTick += carryCapacity / cycleTicks
  }

  const localConsumption = Math.min(source.requiredHarvestPower, builderEnergyPerTick)

  return Math.min(source.requiredCarryCapacity, localConsumption * source.haulerTravel.cycleTravelTicks)
}

function findBuildPathIndex(path: readonly RoomPosition[], target: RoomPosition): number | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const pos = path[i]

    if (pos.roomName === target.roomName && pos.inRangeTo(target, 3)) {
      return i
    }
  }

  return undefined
}

export function createRemoteBuilderBody(room: Room, missingWork: number): readonly BodyPartConstant[] | undefined {
  const maxUnits = Math.floor(room.energyCapacityAvailable / REMOTE_BUILDER_UNIT_COST)

  if (maxUnits <= 0) {
    return
  }

  const neededUnits = Math.ceil(missingWork / REMOTE_BUILDER_UNIT_WORK)

  const units = Math.min(maxUnits, neededUnits)

  if (units <= 0) {
    return
  }

  return [
    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_WORK).fill(WORK),

    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_CARRY).fill(CARRY),

    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_MOVE).fill(MOVE),
  ]
}
