import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import { handoffKnownPathIndex, swapKnownPathIndex } from "../../capabilities/movement/movementRuntime"
import { clearMoveRequest, getIntendedCoord, registerMove } from "../../capabilities/movement/traffic"
import type { LogisticsState } from "../logistics/logistics"
import { getLogisticsSupplierRuntime, swapLogisticsSupplierRuntime } from "../logistics/logisticsRuntime"
import type { HaulTask, HaulTickState, HarvestSourceState, HaulingTickContext } from "./harvestState"
import {
  finishHaulTask,
  HAULER_MOVE_OPTIONS,
  HAULER_PATH_OPTIONS,
  HAULER_REVERSE_PATH_OPTIONS,
  HAULER_ROLE,
} from "./hauler"

interface Coordinate {
  readonly x: number
  readonly y: number
}

interface HaulerCoordinationContext {
  readonly occupantByPosition: Map<string, Creep>
  readonly intendedByCreep: Map<string, Coordinate>
  readonly turnedAround: Set<string>
}

// Resolves logistics results and then applies optional hauling coordination.
export function resolveHauling(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  state: HaulingTickContext,
): void {
  const { haulers, sourceStates, sourceById, haulTickState, speedrun: speedrunState } = state

  const speedrun = speedrunState !== undefined

  finishLogisticsDeliveries(logistics, haulers, sourceStates, sourceById, haulTickState, speedrun)
  runDeliveryFallbacks(room, basePlan, logistics, haulers, sourceStates, sourceById, haulTickState, speedrun)

  if (speedrunState === undefined) {
    return
  }

  const context = createHaulerCoordinationContext(haulers, speedrunState.travelingMiners)

  resolveTombstoneTurnarounds(context, room, basePlan, logistics, haulers, sourceById)
  resolveRelays(context, room, basePlan, logistics, haulers, sourceById)
  resolvePullChains(context, haulers, speedrunState.travelingMiners)
}

function finishLogisticsDeliveries(
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  haulTickState: HaulTickState,
  speedrun: boolean,
): void {
  const emptiedSuppliers = logistics.emptiedSuppliers

  if (emptiedSuppliers === undefined || emptiedSuppliers.size === 0) {
    return
  }

  for (const hauler of haulers) {
    if (!emptiedSuppliers.has(hauler.name) || hauler.memory.haulTask?.phase !== "inbound") {
      continue
    }

    finishHaulTask(hauler, sourceStates, sourceById, haulTickState, speedrun)
  }
}

function runDeliveryFallbacks(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  haulTickState: HaulTickState,
  speedrun: boolean,
): void {
  const fallbackTarget = room.storage ?? getStorageContainer(room, basePlan)
  let fallbackFreeCapacity = fallbackTarget?.store.getFreeCapacity(RESOURCE_ENERGY)

  for (const hauler of haulers) {
    if (
      hauler.room.name !== room.name ||
      !isLoadedDeliverer(hauler) ||
      logistics.handledSuppliers?.has(hauler.name) === true
    ) {
      continue
    }

    const logisticsRuntime = getLogisticsSupplierRuntime(hauler.name)

    if (logisticsRuntime.targetRequestId !== undefined) {
      continue
    }

    if (!isAtDeliveryHome(hauler, basePlan)) {
      continue
    }

    fallbackFreeCapacity = runHomeFallbackAction(
      room,
      basePlan,
      hauler,
      sourceStates,
      sourceById,
      haulTickState,
      speedrun,
      fallbackFreeCapacity,
    )
  }
}

function runHomeFallbackAction(
  room: Room,
  basePlan: BasePlan,
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  haulTickState: HaulTickState,
  speedrun: boolean,
  fallbackFreeCapacity: number | undefined,
): number | undefined {
  const energy = hauler.store.getUsedCapacity(RESOURCE_ENERGY)
  const storage = room.storage

  if (storage !== undefined) {
    const freeCapacity = fallbackFreeCapacity ?? storage.store.getFreeCapacity(RESOURCE_ENERGY)

    if (freeCapacity > 0 && hauler.pos.getRangeTo(storage) <= 1) {
      const transferAmount = Math.min(energy, freeCapacity)

      clearMoveRequest(hauler)

      if (hauler.transfer(storage, RESOURCE_ENERGY, transferAmount) === OK) {
        if (transferAmount >= energy) {
          finishHaulTask(hauler, sourceStates, sourceById, haulTickState, speedrun)
        }

        return freeCapacity - transferAmount
      }
    }

    return freeCapacity
  }

  const storagePos = new RoomPosition(basePlan.storage.x, basePlan.storage.y, room.name)
  const container = getStorageContainer(room, basePlan)
  const freeCapacity = fallbackFreeCapacity ?? container?.store.getFreeCapacity(RESOURCE_ENERGY)

  if (container !== undefined && freeCapacity !== undefined && freeCapacity > 0) {
    if (hauler.pos.getRangeTo(container) <= 1) {
      const transferAmount = Math.min(energy, freeCapacity)

      clearMoveRequest(hauler)

      if (hauler.transfer(container, RESOURCE_ENERGY, transferAmount) === OK) {
        if (transferAmount >= energy) {
          finishHaulTask(hauler, sourceStates, sourceById, haulTickState, speedrun)
        }

        return freeCapacity - transferAmount
      }
    } else {
      moveCreep(hauler, { pos: container.pos, range: 1 }, HAULER_MOVE_OPTIONS)
    }

    return freeCapacity
  }

  if (hauler.pos.isEqualTo(storagePos)) {
    clearMoveRequest(hauler)

    if (hauler.drop(RESOURCE_ENERGY) === OK) {
      finishHaulTask(hauler, sourceStates, sourceById, haulTickState, speedrun)
    }

    return freeCapacity
  }

  moveCreep(hauler, { pos: storagePos, range: 0 }, HAULER_MOVE_OPTIONS)
  return freeCapacity
}

function getStorageContainer(room: Room, basePlan: BasePlan): StructureContainer | undefined {
  return room
    .lookForAt(LOOK_STRUCTURES, basePlan.storage.x, basePlan.storage.y)
    .find((structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER)
}

function isAtDeliveryHome(hauler: Creep, basePlan: BasePlan): boolean {
  const storagePos = new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName)
  return hauler.pos.inRangeTo(storagePos, 1)
}

function createHaulerCoordinationContext(
  haulers: readonly Creep[],
  travelingMiners: readonly Creep[],
): HaulerCoordinationContext {
  const occupantByPosition = new Map<string, Creep>()
  const intendedByCreep = new Map<string, Coordinate>()

  for (const creep of [...haulers, ...travelingMiners]) {
    occupantByPosition.set(getPositionKey(creep.room.name, creep.pos.x, creep.pos.y), creep)

    const intended = getIntendedCoord(creep)

    if (intended !== undefined) {
      intendedByCreep.set(creep.name, intended)
    }
  }

  return {
    occupantByPosition,
    intendedByCreep,
    turnedAround: new Set(),
  }
}

function resolveTombstoneTurnarounds(
  context: HaulerCoordinationContext,
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
): void {
  for (const hauler of haulers) {
    if (!isEmptyFetcher(hauler)) {
      continue
    }

    const intended = context.intendedByCreep.get(hauler.name)

    if (intended === undefined || !isAdjacentCoordinate(hauler.pos, intended)) {
      continue
    }

    const tombstone = hauler.room
      .lookForAt(LOOK_TOMBSTONES, intended.x, intended.y)
      .find((candidate) => candidate.store.getUsedCapacity(RESOURCE_ENERGY) > 0)

    if (tombstone === undefined) {
      continue
    }

    const task = hauler.memory.haulTask

    if (task?.phase !== "outbound") {
      continue
    }

    const source = sourceById.get(task.sourceId)

    if (source === undefined || hauler.withdraw(tombstone, RESOURCE_ENERGY) !== OK) {
      continue
    }

    hauler.memory.haulTask = {
      sourceId: task.sourceId,
      phase: "inbound",
    }

    context.turnedAround.add(hauler.name)

    requestHaulerMovement(room, basePlan, logistics, hauler, source)
    refreshIntended(context, hauler)
  }
}

function resolveRelays(
  context: HaulerCoordinationContext,
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
): void {
  const relayed = new Set<string>()

  for (const supplier of haulers) {
    if (context.turnedAround.has(supplier.name) || relayed.has(supplier.name) || !isLoadedDeliverer(supplier)) {
      continue
    }

    const intended = context.intendedByCreep.get(supplier.name)

    if (intended === undefined || !isAdjacentCoordinate(supplier.pos, intended)) {
      continue
    }

    const fetcher = context.occupantByPosition.get(getPositionKey(supplier.room.name, intended.x, intended.y))

    if (
      fetcher === undefined ||
      fetcher.name === supplier.name ||
      fetcher.room.name !== supplier.room.name ||
      !supplier.pos.isNearTo(fetcher) ||
      context.turnedAround.has(fetcher.name) ||
      relayed.has(fetcher.name) ||
      !isEmptyFetcher(fetcher) ||
      supplier.store.getCapacity(RESOURCE_ENERGY) !== fetcher.store.getCapacity(RESOURCE_ENERGY)
    ) {
      continue
    }

    const fetcherTask = fetcher.memory.haulTask
    const supplierTask = supplier.memory.haulTask

    if (fetcherTask?.phase !== "outbound" || supplierTask?.phase !== "inbound") {
      continue
    }

    const fetcherSource = sourceById.get(fetcherTask.sourceId)
    const supplierSource = sourceById.get(supplierTask.sourceId)

    if (
      fetcherSource === undefined ||
      supplierSource === undefined ||
      supplier.transfer(fetcher, RESOURCE_ENERGY) !== OK
    ) {
      continue
    }

    applyRelay(context, supplier, fetcher, supplierTask, fetcherTask)

    if (shouldHoldRelayFetcher(room, basePlan, logistics, fetcher)) {
      registerMove(fetcher, fetcher.pos)
    } else {
      requestHaulerMovement(room, basePlan, logistics, fetcher, supplierSource)
    }

    requestHaulerMovement(room, basePlan, logistics, supplier, fetcherSource)
    refreshIntended(context, fetcher)
    refreshIntended(context, supplier)

    relayed.add(fetcher.name)
    relayed.add(supplier.name)
  }
}

function applyRelay(
  context: HaulerCoordinationContext,
  supplier: Creep,
  fetcher: Creep,
  supplierTask: HaulTask,
  fetcherTask: HaulTask,
): void {
  fetcher.memory.haulTask = supplierTask
  supplier.memory.haulTask = fetcherTask

  const fetcherIntended = context.intendedByCreep.get(fetcher.name)
  const isMutualRelay =
    fetcherIntended !== undefined && fetcherIntended.x === supplier.pos.x && fetcherIntended.y === supplier.pos.y

  if (isMutualRelay) {
    swapKnownPathIndex(fetcher.name, supplier.name)
  } else {
    handoffKnownPathIndex(supplier.name, fetcher.name)
  }

  swapLogisticsSupplierRuntime(fetcher.name, supplier.name)
}

function resolvePullChains(
  context: HaulerCoordinationContext,
  haulers: readonly Creep[],
  travelingMiners: readonly Creep[],
): void {
  const travelingMinerNames = new Set(travelingMiners.map((miner) => miner.name))
  const followerByFront = new Map<string, Creep>()

  for (const hauler of haulers) {
    if (!isEmptyFetcher(hauler)) {
      continue
    }

    const intended = context.intendedByCreep.get(hauler.name)

    if (intended === undefined || !isAdjacentCoordinate(hauler.pos, intended)) {
      continue
    }

    const front = context.occupantByPosition.get(getPositionKey(hauler.room.name, intended.x, intended.y))

    if (
      front === undefined ||
      front.name === hauler.name ||
      front.room.name !== hauler.room.name ||
      !hauler.pos.isNearTo(front) ||
      (!travelingMinerNames.has(front.name) && !isEmptyFetcher(front))
    ) {
      continue
    }

    const existing = followerByFront.get(front.name)

    if (existing === undefined || hauler.name.localeCompare(existing.name) < 0) {
      followerByFront.set(front.name, hauler)
    }
  }

  for (const miner of travelingMiners) {
    const visited = new Set<string>()
    let front: Creep = miner

    while (!visited.has(front.name)) {
      visited.add(front.name)

      const follower = followerByFront.get(front.name)

      if (follower === undefined) {
        break
      }

      front.pull(follower)
      front = follower
    }
  }
}

function isEmptyFetcher(hauler: Creep): boolean {
  return (
    hauler.memory.role === HAULER_ROLE &&
    !hauler.spawning &&
    hauler.memory.haulTask?.phase === "outbound" &&
    hauler.store.getUsedCapacity() === 0
  )
}

function isLoadedDeliverer(hauler: Creep): boolean {
  return (
    !hauler.spawning && hauler.memory.haulTask?.phase === "inbound" && hauler.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  )
}

function requestHaulerMovement(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  hauler: Creep,
  source: HarvestSourceState,
): void {
  const task = hauler.memory.haulTask

  if (task?.phase === "outbound") {
    moveCreepByPath(hauler, source.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
    return
  }

  if (task?.phase !== "inbound") {
    return
  }

  const logisticsRuntime = getLogisticsSupplierRuntime(hauler.name)
  const targetRequestId = logisticsRuntime.targetRequestId
  const request = targetRequestId === undefined ? undefined : logistics.energyRequests.get(targetRequestId)

  if (request !== undefined) {
    if (hauler.pos.isNearTo(request.target)) {
      clearMoveRequest(hauler)
    } else {
      moveCreep(
        hauler,
        {
          pos: request.target.pos,
          range: 1,
        },
        HAULER_MOVE_OPTIONS,
      )
    }

    return
  }

  if (hauler.room.name === room.name && isAtDeliveryHome(hauler, basePlan)) {
    requestHomeFallbackMovement(room, basePlan, hauler)
    return
  }

  moveCreepByPath(hauler, source.haulerTravel.loadedPath, HAULER_REVERSE_PATH_OPTIONS)
}

function requestHomeFallbackMovement(room: Room, basePlan: BasePlan, hauler: Creep): void {
  const storage = room.storage

  if (storage !== undefined) {
    clearMoveRequest(hauler)
    return
  }

  const storagePos = new RoomPosition(basePlan.storage.x, basePlan.storage.y, room.name)
  const container = getStorageContainer(room, basePlan)

  if (
    container !== undefined &&
    container.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
    hauler.pos.getRangeTo(container) <= 1
  ) {
    clearMoveRequest(hauler)
    return
  }

  if (hauler.pos.isEqualTo(storagePos)) {
    clearMoveRequest(hauler)
    return
  }

  moveCreep(hauler, { pos: storagePos, range: 0 }, HAULER_MOVE_OPTIONS)
}

function shouldHoldRelayFetcher(room: Room, basePlan: BasePlan, logistics: LogisticsState, fetcher: Creep): boolean {
  const logisticsRuntime = getLogisticsSupplierRuntime(fetcher.name)
  const targetRequestId = logisticsRuntime.targetRequestId
  const request = targetRequestId === undefined ? undefined : logistics.energyRequests.get(targetRequestId)

  if (request !== undefined) {
    return false
  }

  const storage = room.storage

  if (storage !== undefined) {
    return storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && fetcher.pos.isNearTo(storage)
  }

  const storagePos = new RoomPosition(basePlan.storage.x, basePlan.storage.y, room.name)
  const container = getStorageContainer(room, basePlan)

  if (container !== undefined && container.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return fetcher.pos.inRangeTo(container, 1)
  }

  return fetcher.pos.isEqualTo(storagePos)
}

function refreshIntended(context: HaulerCoordinationContext, creep: Creep): void {
  const intended = getIntendedCoord(creep)

  if (intended === undefined) {
    context.intendedByCreep.delete(creep.name)
    return
  }

  context.intendedByCreep.set(creep.name, intended)
}

function isAdjacentCoordinate(pos: RoomPosition, coordinate: Coordinate): boolean {
  return Math.max(Math.abs(pos.x - coordinate.x), Math.abs(pos.y - coordinate.y)) <= 1
}

function getPositionKey(roomName: string, x: number, y: number): string {
  return `${roomName}:${x}:${y}`
}
