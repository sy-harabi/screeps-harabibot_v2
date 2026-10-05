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

interface HaulSourceTickState {
  pendingEnergy: number
  haulerCount: number
}

export type HaulTickState = Map<Id<Source>, HaulSourceTickState>

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
  haulTickState: HaulTickState,
  speedrun: boolean,
): void {
  for (const hauler of haulers) {
    if (hauler.spawning) {
      continue
    }

    const task = hauler.memory.haulTask ?? assignHauler(hauler, sourceStates, haulTickState, speedrun)

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
        haulTickState, speedrun,
        logistics,
      )
      continue
    }

    const source = sourceById.get(task.sourceId)

    if (source === undefined) {
      decrementSourceHaulerCount(haulTickState, task.sourceId)
      clearHaulTask(hauler)
      continue
    }

    if (runFetch(hauler, source) === 'emptyTimeout') {
      finishHaulTask(
        hauler,
        sourceStates,
        sourceById,
        haulTickState, speedrun,
      )
    }
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
  haulTickState: HaulTickState,
  speedrun: boolean,
  logistics: LogisticsState,
): void {
  if (hauler.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    finishHaulTask(hauler, sourceStates, sourceById, haulTickState, speedrun)
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
  haulTickState: HaulTickState,
  speedrun: boolean,
): void {
  const previousSourceId = hauler.memory.haulTask?.sourceId

  if (previousSourceId !== undefined) {
    decrementSourceHaulerCount(haulTickState, previousSourceId)
  }

  clearHaulTask(hauler)

  const task = assignHauler(
    hauler,
    sourceStates,
    haulTickState,
    speedrun,
  )

  if (task === undefined) {
    return
  }

  const source = sourceById.get(task.sourceId)

  if (source === undefined) {
    decrementSourceHaulerCount(haulTickState, task.sourceId)
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
    if (hauler.room.name !== sourcePos.roomName ||
      !hauler.pos.inRangeTo(sourcePos, 1)) {
      moveCreepByPath(hauler, sourceState.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
      return 'normal'
    }

    hauler.memory.haulTask = {
      sourceId: task.sourceId,
      phase: "loading",
      loadingSince: Game.time,
    }
  } else if (task.phase !== 'loading') {
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

export function createHaulTickState(
  sourceStates: readonly HarvestSourceState[],
  haulers: readonly Creep[],
): HaulTickState {
  const result: HaulTickState = new Map()

  for (const source of sourceStates) {
    const availableEnergy =
      source.sourceObject === undefined
        ? 0
        : source.containerEnergy + source.droppedEnergy

    const builderReserve = source.remoteBuilderCarryCapacity ?? 0
    const repairerReserve = source.remoteRepairerCarryCapacity ?? 0

    result.set(source.id, {
      pendingEnergy: availableEnergy - builderReserve - repairerReserve,
      haulerCount: 0,
    })
  }

  for (const hauler of haulers) {
    const task = hauler.memory.haulTask

    if (task === undefined) {
      continue
    }

    const state = result.get(task.sourceId)

    if (state === undefined) {
      continue
    }

    state.haulerCount++

    if (task.phase === "outbound" || task.phase === "loading") {
      state.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
    }
  }

  return result
}

function assignHauler(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  haulTickState: HaulTickState,
  speedrun: boolean,
): HaulTask | undefined {
  const capacity = hauler.store.getCapacity(RESOURCE_ENERGY)

  for (const sourceState of sourceStates) {
    const state = haulTickState.get(sourceState.id)

    if (state === undefined) {
      continue
    }

    const source = sourceState.sourceObject
    const relayTicks = speedrun ? state.haulerCount : 0
    const emptyTravelTicks = Math.max(0, sourceState.haulerTravel.emptyTravelTicks - relayTicks)

    const expectedEnergy =
      state.pendingEnergy +
      (source === undefined ? 0 : getExpectedEnergyDelta(source, sourceState, emptyTravelTicks))

    if (expectedEnergy < capacity) {
      continue
    }

    const cycleTravelTicks = Math.max(0, sourceState.haulerCycleTravelTicks - relayTicks)

    if (
      !speedrun &&
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

    state.pendingEnergy -= capacity
    state.haulerCount++

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

function decrementSourceHaulerCount(
  haulTickState: HaulTickState,
  sourceId: Id<Source>,
): void {
  const state = haulTickState.get(sourceId)

  if (state === undefined || state.haulerCount <= 0) {
    return
  }

  state.haulerCount--
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
