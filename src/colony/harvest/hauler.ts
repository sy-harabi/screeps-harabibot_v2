import {
  moveCreep,
  moveCreepByPath,
  type MoveByPathOptions,
  type MoveOptions,
} from "../../capabilities/movement/movement"
import { getBotOptions } from "../../options/botOptions"
import type { LogisticsState } from "../logistics/logistics"
import { registerEnergySupplier } from "../logistics/logistics"
import { getLogisticsSupplierRuntime } from "../logistics/logisticsRuntime"
import type { HarvestSourceState } from "./harvest"
import { getHaulerRoomCostMatrix } from "./haulerCostMatrix"
export const HAULER_ROLE = "hauler"

export type HaulerProfile = "1:1" | "2:1"

const SPEEDRUN_HAULER_MAX_CARRY = 3
const LOGISTICS_ENTRY_RANGE = 6

export const HAULER_MOVE_OPTIONS: MoveOptions = {
  roomCostMatrixModifier: getHaulerRoomCostMatrix,
  pathPolicy: "hauler",
}

const HAULER_ROUTE_MOVE_OPTIONS: MoveOptions = {
  ...HAULER_MOVE_OPTIONS,
  useRoomRoute: true,
}

export const HAULER_PATH_OPTIONS: MoveByPathOptions = {
  roomCostMatrixModifier: getHaulerRoomCostMatrix,
  pathPolicy: "hauler",
}

export const HAULER_REVERSE_PATH_OPTIONS: MoveByPathOptions = {
  ...HAULER_PATH_OPTIONS,
  reverse: true,
}

// Phase 1 runs normal hauling and registers eligible deliverers with colony logistics.
export function runHaulersPhase1(
  colonyName: string,
  storagePos: RoomPosition,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  logistics: LogisticsState,
  sourceHaulerCounts?: Map<Id<Source>, number>,
): void {
  preparePendingEnergy(sourceStates)

  for (const hauler of haulers) {
    const state = hauler.memory.haulerState
    const sourceId = hauler.memory.sourceId

    if (sourceId === undefined || (state !== "fetching" && state !== "loading")) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined) {
      continue
    }

    source.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
  }

  for (const hauler of haulers) {
    if (hauler.spawning) {
      continue
    }

    switch (hauler.memory.haulerState) {
      case "idle":
        if (!assignHauler(hauler, sourceStates, sourceHaulerCounts)) {
          continue
        }
        break

      case "fetching":
      case "loading":
        break

      case "delivering":
        runDeliveryPhase1(
          colonyName,
          storagePos,
          hauler,
          sourceStates,
          sourceById,
          sourceHaulerCounts,
          logistics,
        )
        continue

      default:
        continue
    }

    const sourceId = hauler.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined) {
      decrementSourceHaulerCount(sourceHaulerCounts, sourceId)
      clearHaulerTrip(hauler)
      continue
    }

    runFetch(hauler, source)
  }
}

function runDeliveryPhase1(
  colonyName: string,
  storagePos: RoomPosition,
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number> | undefined,
  logistics: LogisticsState,
): void {
  if (hauler.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    finishHaulerDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts)
    return
  }

  if (!moveAlongLoadedPath(hauler, sourceById) && !hauler.pos.inRangeTo(storagePos, LOGISTICS_ENTRY_RANGE)) {
    moveCreep(hauler, { pos: storagePos, range: LOGISTICS_ENTRY_RANGE }, HAULER_ROUTE_MOVE_OPTIONS)
  }

  const logisticsRuntime = getLogisticsSupplierRuntime(hauler.name)
  const shouldRegisterLogistics =
    logisticsRuntime.targetRequestId !== undefined ||
    (hauler.room.name === colonyName && hauler.pos.inRangeTo(storagePos, LOGISTICS_ENTRY_RANGE))

  if (shouldRegisterLogistics) {
    registerEnergySupplier(logistics, hauler, HAULER_MOVE_OPTIONS)
  }
}

function moveAlongLoadedPath(hauler: Creep, sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>): boolean {
  const sourceId = hauler.memory.sourceId
  const source = sourceId === undefined ? undefined : sourceById.get(sourceId)

  if (source === undefined) {
    return false
  }

  moveCreepByPath(hauler, getLoadedPath(hauler, source), HAULER_REVERSE_PATH_OPTIONS)
  return true
}

function getLoadedPath(hauler: Creep, source: HarvestSourceState): readonly RoomPosition[] {
  if (hauler.memory.haulerProfile === "2:1" && source.useRoadPath) {
    return source.path
  }

  return source.haulerTravel.loadedPath
}

function moveToSource(hauler: Creep, source: HarvestSourceState): void {
  moveCreepByPath(hauler, source.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
}

export function finishHaulerDelivery(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number> | undefined,
): void {
  const previousSourceId = hauler.memory.sourceId

  if (previousSourceId !== undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, previousSourceId)
  }

  clearHaulerTrip(hauler)

  if (!assignHauler(hauler, sourceStates, sourceHaulerCounts)) {
    return
  }

  const sourceId = hauler.memory.sourceId

  if (sourceId === undefined) {
    return
  }

  const source = sourceById.get(sourceId)

  if (source === undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, sourceId)
    clearHaulerTrip(hauler)
    return
  }

  moveToSource(hauler, source)
}

function clearHaulerTrip(hauler: Creep): void {
  delete hauler.memory.sourceId
  hauler.memory.haulerState = "idle"
}

function runFetch(hauler: Creep, sourceState: HarvestSourceState): void {
  const path = sourceState.path
  const sourcePos = path[path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (hauler.memory.haulerState === "fetching") {
    if (hauler.room.name !== sourcePos.roomName || !hauler.pos.inRangeTo(sourcePos, 1)) {
      moveCreepByPath(hauler, sourceState.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
      return
    }

    hauler.memory.haulerState = "loading"
  } else if (hauler.memory.haulerState === "loading") {
    if (Game.rooms[sourcePos.roomName] === undefined) {
      moveCreep(
        hauler,
        {
          pos: new RoomPosition(25, 25, sourcePos.roomName),
          range: 20,
        },
        HAULER_ROUTE_MOVE_OPTIONS,
      )
      return
    }
  } else {
    return
  }

  const source = sourceState.sourceObject

  if (source === undefined) {
    moveCreep(hauler, { pos: sourcePos, range: 1 }, HAULER_MOVE_OPTIONS)
    return
  }

  const droppedEnergy = sourceState.largestDroppedEnergy
  const freeCapacity = hauler.store.getFreeCapacity(RESOURCE_ENERGY)

  if (freeCapacity === 0) {
    startDelivering(hauler, sourceState)
    return
  }

  if (droppedEnergy !== undefined) {
    if (!hauler.pos.isNearTo(droppedEnergy)) {
      moveCreep(
        hauler,
        {
          pos: droppedEnergy.pos,
          range: 1,
        },
        HAULER_MOVE_OPTIONS,
      )
      return
    }

    if (hauler.pickup(droppedEnergy) === OK) {
      if (droppedEnergy.amount >= freeCapacity || source.energy === 0) {
        startDelivering(hauler, sourceState)
      }
    }

    return
  }

  const container = sourceState.container

  if (container !== undefined) {
    if (!hauler.pos.isNearTo(container)) {
      moveCreep(
        hauler,
        {
          pos: container.pos,
          range: 1,
        },
        HAULER_MOVE_OPTIONS,
      )
      return
    }

    const amount = container.store.getUsedCapacity(RESOURCE_ENERGY)

    if (amount >= freeCapacity || (amount > 0 && source.energy === 0)) {
      if (hauler.withdraw(container, RESOURCE_ENERGY) === OK) {
        startDelivering(hauler, sourceState)
      }

      return
    }
  }

  if (!hauler.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(hauler, { pos: sourcePos, range: 1 }, HAULER_MOVE_OPTIONS)
  }
}

function startDelivering(hauler: Creep, sourceState: HarvestSourceState): void {
  hauler.memory.haulerState = "delivering"
  moveCreepByPath(hauler, getLoadedPath(hauler, sourceState), HAULER_REVERSE_PATH_OPTIONS)
}

function preparePendingEnergy(sourceStates: readonly HarvestSourceState[]): void {
  for (const sourceState of sourceStates) {
    const availableEnergy =
      sourceState.sourceObject === undefined ? 0 : sourceState.containerEnergy + sourceState.droppedEnergy

    sourceState.pendingEnergy = availableEnergy - (sourceState.remoteBuilderCarryCapacity ?? 0)
  }
}

function assignHauler(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceHaulerCounts: Map<Id<Source>, number> | undefined,
): boolean {
  const capacity = hauler.store.getCapacity(RESOURCE_ENERGY)

  for (const sourceState of sourceStates) {
    const source = sourceState.sourceObject
    const assignedHaulerCount = sourceHaulerCounts?.get(sourceState.id) ?? 0
    const relayTicks = assignedHaulerCount
    const emptyTravelTicks = Math.max(0, sourceState.haulerTravel.emptyTravelTicks - relayTicks)
    const expectedEnergy =
      sourceState.pendingEnergy +
      (source === undefined ? 0 : getExpectedEnergyDelta(source, sourceState, emptyTravelTicks))

    if (expectedEnergy < capacity) {
      continue
    }

    const cycleTravelTicks = Math.max(0, sourceState.haulerCycleTravelTicks - relayTicks)

    if (
      sourceHaulerCounts === undefined &&
      hauler.ticksToLive !== undefined &&
      hauler.ticksToLive <= cycleTravelTicks + 20
    ) {
      continue
    }

    hauler.memory.sourceId = sourceState.id
    hauler.memory.haulerState = "fetching"
    sourceState.pendingEnergy -= capacity

    if (sourceHaulerCounts !== undefined) {
      sourceHaulerCounts.set(sourceState.id, assignedHaulerCount + 1)
    }

    return true
  }

  return false
}

function getExpectedEnergyDelta(source: Source, sourceState: HarvestSourceState, travelTicks: number): number {
  const regeneration = source.ticksToRegeneration ?? ENERGY_REGEN_TIME

  if (travelTicks < regeneration) {
    return Math.min(source.energy, sourceState.activeHarvestPower * travelTicks)
  }

  return (
    Math.min(source.energy, sourceState.activeHarvestPower * regeneration) +
    sourceState.activeHarvestPower * (travelTicks - regeneration)
  )
}

export function countSourceHaulers(haulers: readonly Creep[]): Map<Id<Source>, number> {
  const result = new Map<Id<Source>, number>()

  for (const hauler of haulers) {
    const sourceId = hauler.memory.sourceId

    if (sourceId !== undefined) {
      result.set(sourceId, (result.get(sourceId) ?? 0) + 1)
    }
  }

  return result
}

function decrementSourceHaulerCount(
  counts: Map<Id<Source>, number> | undefined,
  sourceId: Id<Source>,
): void {
  if (counts === undefined) {
    return
  }

  const count = counts.get(sourceId)

  if (count === undefined || count <= 1) {
    counts.delete(sourceId)
    return
  }

  counts.set(sourceId, count - 1)
}

export function getRequiredCarryCapacity(
  energyPerTick: number,
  cycleTravelTicks: number,
  relayPathLength?: number,
): number {
  if (relayPathLength === undefined) {
    return cycleTravelTicks * energyPerTick
  }

  if (energyPerTick <= 0 || relayPathLength <= 0) {
    return 0
  }

  const haulerCapacity = SPEEDRUN_HAULER_MAX_CARRY * CARRY_CAPACITY

  return (haulerCapacity * relayPathLength * (Math.sqrt(1 + (8 * energyPerTick) / haulerCapacity) - 1)) / 2
}

export function createHaulerBody(room: Room, profile: HaulerProfile = "1:1"): readonly BodyPartConstant[] | undefined {
  const budget = room.energyAvailable
  const speedrun = getBotOptions().speedrun
  const unit = speedrun || profile === "1:1" ? [CARRY, MOVE] : [CARRY, CARRY, MOVE]
  const unitCost = unit.reduce((prev, curr) => prev + BODYPART_COST[curr], 0)

  if (budget < unitCost) {
    return undefined
  }

  const maxUnits = speedrun ? SPEEDRUN_HAULER_MAX_CARRY : Math.floor(MAX_CREEP_SIZE / unit.length)
  const unitCount = Math.min(Math.floor(budget / unitCost), maxUnits)

  const result: BodyPartConstant[] = []

  for (let i = 0; i < unitCount; i++) {
    result.push(...unit)
  }

  return result
}
