import { moveCreep } from "../../capabilities/movement/movement"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { type HarvestSourceState } from "./harvestState"

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
  } else if ((state === "fetching" || state === "loading") && freeCapacity === 0) {
    state = "building"
  }

  builder.memory.remoteBuilderState = state

  if (state === "fetching" || state === "loading") {
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

  const targetRange = isSourceContainerTarget(source, target) ? 1 : 0
  const range = builder.room.name === target.roomName ? builder.pos.getRangeTo(target) : Infinity

  if (range <= 3) {
    const targetRoom = Game.rooms[target.roomName]
    const site = targetRoom
      ?.lookForAt(LOOK_CONSTRUCTION_SITES, target.x, target.y)
      .find((site) => site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD)

    if (site !== undefined) {
      builder.build(site)
    }
  }

  if (range > targetRange) {
    moveCreep(builder, {
      pos: target,
      range: targetRange,
    })
  }
}

function runRemoteBuilderFetch(builder: Creep, source: HarvestSourceState): void {
  const sourcePos = source.path[source.path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (builder.memory.remoteBuilderState === "fetching") {
    if (builder.room.name !== sourcePos.roomName || !builder.pos.inRangeTo(sourcePos, 1)) {
      moveCreep(builder, {
        pos: sourcePos,
        range: 1,
      })
      return
    }

    builder.memory.remoteBuilderState = "loading"
  }

  if (builder.memory.remoteBuilderState !== "loading") {
    return
  }

  if (Game.rooms[sourcePos.roomName] === undefined) {
    moveCreep(builder, {
      pos: new RoomPosition(25, 25, sourcePos.roomName),
      range: 20,
    })
    return
  }

  const sourceObject = source.sourceObject

  if (sourceObject === undefined) {
    moveCreep(builder, {
      pos: sourcePos,
      range: 1,
    })
    return
  }

  const dropped = source.largestDroppedEnergy

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
    return
  }

  if (!builder.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(builder, {
      pos: sourcePos,
      range: 1,
    })
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
  targetIndex: number,
): number {
  let builderEnergyPerTick = 0

  const buildPathIndex = findBuildPathIndex(source.path, targetIndex)

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

  return Math.min(source.requiredCarryCapacity, localConsumption * source.haulerCycleTravelTicks)
}

function isSourceContainerTarget(source: HarvestSourceState, target: RoomPosition): boolean {
  const sourcePos = source.path[source.path.length - 1]

  return sourcePos !== undefined && sourcePos.isEqualTo(target)
}

function findBuildPathIndex(path: readonly RoomPosition[], targetIndex: number): number {
  const target = path[targetIndex]

  if (target === undefined) {
    return targetIndex
  }

  for (let i = Math.min(path.length - 1, targetIndex + 3); i >= targetIndex; i--) {
    const pos = path[i]

    if (pos.roomName === target.roomName && pos.inRangeTo(target, 3)) {
      return i
    }
  }

  return targetIndex
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
