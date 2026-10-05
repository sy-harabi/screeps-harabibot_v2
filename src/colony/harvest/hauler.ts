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

export type HaulTask =
  | {
    sourceId: Id<Source>
    phase: "outbound"
  }
  | {
    sourceId: Id<Source>
    phase: "loading"
    loadingSince: number
  }
  | {
    sourceId: Id<Source>
    phase: "inbound"
  }

export type HaulerProfile = "1:1" | "2:1"


const SPEEDRUN_HAULER_MAX_CARRY = 3
const LOGISTICS_ENTRY_RANGE = 6
const LOADING_TIMEOUT = 25

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

// Advances normal hauling and registers eligible inbound haulers with colony logistics.
export function prepareHauling(
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
    const task = hauler.memory.haulTask

    if (task == undefined || task.phase !== 'outbound' && task.phase !== 'loading') {
      continue
    }

    const source = sourceById.get(task.sourceId)

    if (source === undefined) {
      continue
    }

    source.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
  }

  for (const hauler of haulers) {
    if (hauler.spawning) {
      continue
    }

    const task = hauler.memory.haulTask ?? assignHauler(hauler, sourceStates, sourceHaulerCounts)

    if (task === undefined) {
      continue
    }

    if (task.phase === "inbound") {
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
    }

    const source = sourceById.get(task.sourceId)

    if (source === undefined) {
      decrementSourceHaulerCount(sourceHaulerCounts, task.sourceId)
      clearHaulTask(hauler)
      continue
    }

    if (runFetch(hauler, source) === 'normal') {
      continue
    }

    finishHaulTask(
      hauler,
      sourceStates,
      sourceById,
      sourceHaulerCounts,
    )
  }
}

function clearHaulTask(hauler: Creep): void {
  delete hauler.memory.haulTask
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
    finishHaulTask(hauler, sourceStates, sourceById, sourceHaulerCounts)
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
  const task = hauler.memory.haulTask
  const source = task === undefined ? undefined : sourceById.get(task.sourceId)

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

export function finishHaulTask(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number> | undefined,
): void {
  const previousSourceId = hauler.memory.haulTask?.sourceId

  if (previousSourceId !== undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, previousSourceId)
  }

  clearHaulTask(hauler)

  if (!assignHauler(hauler, sourceStates, sourceHaulerCounts)) {
    return
  }

  const task = hauler.memory.haulTask

  if (task === undefined) {
    return
  }

  const source = sourceById.get(task.sourceId)

  if (source === undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, task.sourceId)
    clearHaulTask(hauler)
    return
  }

  moveToSource(hauler, source)
}

type FetchResult = "normal" | "emptyTimeout"

function runFetch(hauler: Creep, sourceState: HarvestSourceState): FetchResult {
  const task = hauler.memory.haulTask

  if (task === undefined) {
    return 'normal'
  }

  const path = sourceState.path
  const sourcePos = path[path.length - 1]

  if (sourcePos === undefined) {
    return 'normal'
  }

  if (task.phase === "outbound") {
    if (hauler.pos.getRangeTo(sourcePos) > 1) {
      moveCreepByPath(hauler, sourceState.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
      return 'normal'
    }

    hauler.memory.haulTask = {
      sourceId: task.sourceId,
      phase: "loading",
      loadingSince: Game.time,
    }
  }

  if (task.phase !== 'loading') {
    return 'normal'
  }

  if (Game.rooms[sourcePos.roomName] === undefined) {
    moveCreep(
      hauler,
      {
        pos: new RoomPosition(25, 25, sourcePos.roomName),
        range: 20,
      },
      HAULER_ROUTE_MOVE_OPTIONS,
    )
    return 'normal'
  }

  const source = sourceState.sourceObject

  if (source === undefined) {
    moveCreep(hauler, { pos: sourcePos, range: 1 }, HAULER_MOVE_OPTIONS)
    return 'normal'
  }

  const droppedEnergy = sourceState.largestDroppedEnergy
  const freeCapacity = hauler.store.getFreeCapacity(RESOURCE_ENERGY)

  if (freeCapacity === 0) {
    startDelivering(hauler, sourceState)
    return 'normal'
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
      return 'normal'
    }

    if (hauler.pickup(droppedEnergy) === OK) {
      if (droppedEnergy.amount >= freeCapacity || source.energy === 0) {
        startDelivering(hauler, sourceState)
      }
    }

    return 'normal'
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
      return 'normal'
    }

    const amount = container.store.getUsedCapacity(RESOURCE_ENERGY)

    if (amount >= freeCapacity || (amount > 0 && source.energy === 0)) {
      if (hauler.withdraw(container, RESOURCE_ENERGY) === OK) {
        startDelivering(hauler, sourceState)
      }

      return 'normal'
    }
  }

  const currentTask = hauler.memory.haulTask

  if (
    currentTask?.phase === "loading" &&
    Game.time - currentTask.loadingSince >= LOADING_TIMEOUT
  ) {
    if (hauler.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      return 'emptyTimeout'
    }

    startDelivering(hauler, sourceState)
    return 'normal'
  }

  if (!hauler.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(hauler, { pos: sourcePos, range: 1 }, HAULER_MOVE_OPTIONS)
  }

  return 'normal'
}

function startDelivering(hauler: Creep, sourceState: HarvestSourceState): void {
  hauler.memory.haulTask = {
    sourceId: sourceState.id,
    phase: "inbound",
  }
  moveCreepByPath(hauler, getLoadedPath(hauler, sourceState), HAULER_REVERSE_PATH_OPTIONS)
}

function preparePendingEnergy(sourceStates: readonly HarvestSourceState[]): void {
  for (const sourceState of sourceStates) {
    const availableEnergy =
      sourceState.sourceObject === undefined ? 0 : sourceState.containerEnergy + sourceState.droppedEnergy

    const builderReserve = sourceState.remoteBuilderCarryCapacity ?? 0
    const repairerReserve = sourceState.remoteRepairerCarryCapacity ?? 0

    sourceState.pendingEnergy = availableEnergy - builderReserve - repairerReserve
  }
}

function assignHauler(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceHaulerCounts: Map<Id<Source>, number> | undefined,
): HaulTask | undefined {
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

    const task: HaulTask = {
      sourceId: sourceState.id,
      phase: "outbound",
    }


    hauler.memory.haulTask = task
    sourceState.pendingEnergy -= capacity

    if (sourceHaulerCounts !== undefined) {
      sourceHaulerCounts.set(sourceState.id, assignedHaulerCount + 1)
    }

    return task
  }

  return
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
    const sourceId = hauler.memory.haulTask?.sourceId

    if (sourceId !== undefined) {
      result.set(sourceId, (result.get(sourceId) ?? 0) + 1)
    }
  }

  return result
}

function decrementSourceHaulerCount(counts: Map<Id<Source>, number> | undefined, sourceId: Id<Source>): void {
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
