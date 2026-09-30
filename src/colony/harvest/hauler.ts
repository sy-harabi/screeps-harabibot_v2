import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import {
  moveCreep,
  moveCreepByPath,
  type MoveByPathOptions,
  type MoveOptions,
} from "../../capabilities/movement/movement"
import { handoffKnownPathIndex, swapKnownPathIndex } from "../../capabilities/movement/movementRuntime"
import { clearMoveRequest, getIntendedCoord } from "../../capabilities/movement/traffic"
import { getBotOptions } from "../../options/botOptions"
import type { LogisticsState } from "../logistics/logistics"
import { registerEnergySupplier } from "../logistics/logistics"
import { getLogisticsSupplierRuntime, swapLogisticsSupplierRuntime } from "../logistics/logisticsRuntime"
import type { HarvestSourceState } from "./harvest"
import { getHaulerRoomCostMatrix } from "./haulerCostMatrix"
export const HAULER_ROLE = "hauler"

const SPEEDRUN_HAULER_MAX_CARRY = 2
const LOGISTICS_ENTRY_RANGE = 6

const HAULER_MOVE_OPTIONS: MoveOptions = {
  roomCostMatrixModifier: getHaulerRoomCostMatrix,
  pathPolicy: "hauler",
}

const HAULER_ROUTE_MOVE_OPTIONS: MoveOptions = {
  ...HAULER_MOVE_OPTIONS,
  useRoomRoute: true,
}

const HAULER_PATH_OPTIONS: MoveByPathOptions = {
  roomCostMatrixModifier: getHaulerRoomCostMatrix,
  pathPolicy: "hauler",
}

const HAULER_REVERSE_PATH_OPTIONS: MoveByPathOptions = {
  ...HAULER_PATH_OPTIONS,
  reverse: true,
}

export function runHaulers(
  colonyName: string,
  storagePos: RoomPosition,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  logistics: LogisticsState,
): void {
  const relayEnabled = getBotOptions().speedrun
  const sourceHaulerCounts = countSourceHaulers(haulers)

  preparePendingEnergy(sourceStates)

  for (const hauler of haulers) {
    if (hauler.memory.sourceId === undefined || hauler.memory.delivering) {
      continue
    }

    const source = sourceById.get(hauler.memory.sourceId)

    if (source === undefined) {
      continue
    }

    source.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
  }

  for (const hauler of haulers) {
    if (hauler.spawning) {
      continue
    }

    if (hauler.memory.delivering) {
      if (hauler.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        finishDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts, relayEnabled)
        continue
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

      continue
    }

    if (hauler.memory.sourceId === undefined) {
      assignHauler(hauler, sourceStates, sourceHaulerCounts, relayEnabled)
    }

    const sourceId = hauler.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined) {
      decrementSourceHaulerCount(sourceHaulerCounts, sourceId)
      delete hauler.memory.sourceId
      delete hauler.memory.searchingEnergy
      continue
    }

    runFetch(hauler, source)
  }
}

function moveAlongLoadedPath(hauler: Creep, sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>): boolean {
  const sourceId = hauler.memory.sourceId
  const source = sourceId === undefined ? undefined : sourceById.get(sourceId)

  if (source === undefined) {
    return false
  }

  moveCreepByPath(hauler, source.haulerTravel.loadedPath, HAULER_REVERSE_PATH_OPTIONS)
  return true
}

function moveToSource(hauler: Creep, source: HarvestSourceState): void {
  moveCreepByPath(hauler, source.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
}

function finishDelivery(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number>,
  relayEnabled: boolean,
): void {
  const previousSourceId = hauler.memory.sourceId

  if (previousSourceId !== undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, previousSourceId)
  }

  delete hauler.memory.sourceId
  delete hauler.memory.delivering
  delete hauler.memory.searchingEnergy

  if (!assignHauler(hauler, sourceStates, sourceHaulerCounts, relayEnabled)) {
    return
  }

  const sourceId = hauler.memory.sourceId

  if (sourceId === undefined) {
    return
  }

  const source = sourceById.get(sourceId)

  if (source === undefined) {
    decrementSourceHaulerCount(sourceHaulerCounts, sourceId)
    delete hauler.memory.sourceId
    delete hauler.memory.searchingEnergy
    return
  }

  moveToSource(hauler, source)
}

function runFetch(hauler: Creep, sourceState: HarvestSourceState): void {
  const path = sourceState.path
  const sourcePos = path[path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (!hauler.memory.searchingEnergy) {
    if (hauler.room.name !== sourcePos.roomName || !hauler.pos.inRangeTo(sourcePos, 1)) {
      moveCreepByPath(hauler, sourceState.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
      return
    }

    hauler.memory.searchingEnergy = true
  } else if (Game.rooms[sourcePos.roomName] === undefined) {
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

  const source = Game.getObjectById(sourceState.id)

  if (source === null) {
    moveCreep(hauler, { pos: sourcePos, range: 1 }, HAULER_MOVE_OPTIONS)
    return
  }

  const droppedEnergy = getDroppedEnergy(source)
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
  delete hauler.memory.searchingEnergy
  hauler.memory.delivering = true
  moveCreepByPath(hauler, sourceState.haulerTravel.loadedPath, HAULER_REVERSE_PATH_OPTIONS)
}

function getDroppedEnergy(source: Source): Resource<ResourceConstant> | undefined {
  let result: Resource<ResourceConstant> | undefined

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType !== RESOURCE_ENERGY) {
      continue
    }

    if (result === undefined || resource.amount > result.amount) {
      result = resource
    }
  }

  return result
}

function preparePendingEnergy(sourceStates: readonly HarvestSourceState[]): void {
  for (const sourceState of sourceStates) {
    const source = Game.getObjectById(sourceState.id)

    sourceState.pendingEnergy = source === null ? 0 : sourceState.containerEnergy + sourceState.droppedEnergy
  }
}

function assignHauler(
  hauler: Creep,
  sourceStates: readonly HarvestSourceState[],
  sourceHaulerCounts: Map<Id<Source>, number>,
  relayEnabled: boolean,
): boolean {
  const capacity = hauler.store.getCapacity(RESOURCE_ENERGY)

  for (const sourceState of sourceStates) {
    const source = Game.getObjectById(sourceState.id)
    const assignedHaulerCount = sourceHaulerCounts.get(sourceState.id) ?? 0
    const relayTicks = relayEnabled ? assignedHaulerCount : 0
    const emptyTravelTicks = Math.max(0, sourceState.haulerTravel.emptyTravelTicks - relayTicks)
    const expectedEnergy =
      sourceState.pendingEnergy + (source === null ? 0 : getExpectedEnergyDelta(source, sourceState, emptyTravelTicks))

    if (expectedEnergy < capacity) {
      continue
    }

    const cycleTravelTicks = Math.max(0, sourceState.haulerTravel.cycleTravelTicks - relayTicks)

    if (!getBotOptions().speedrun && hauler.ticksToLive !== undefined && hauler.ticksToLive <= cycleTravelTicks + 20) {
      continue
    }

    delete hauler.memory.searchingEnergy
    hauler.memory.sourceId = sourceState.id
    sourceState.pendingEnergy -= capacity
    sourceHaulerCounts.set(sourceState.id, assignedHaulerCount + 1)

    return true
  }

  return false
}

function getExpectedEnergyDelta(source: Source, sourceState: HarvestSourceState, travelTicks: number): number {
  const regeneration = source.ticksToRegeneration ?? ENERGY_REGEN_TIME

  if (travelTicks < regeneration) {
    return Math.min(source.energy, sourceState.harvestingPower * travelTicks)
  }

  return (
    Math.min(source.energy, sourceState.harvestingPower * regeneration) +
    sourceState.harvestingPower * (travelTicks - regeneration)
  )
}

function countSourceHaulers(haulers: readonly Creep[]): Map<Id<Source>, number> {
  const result = new Map<Id<Source>, number>()

  for (const hauler of haulers) {
    const sourceId = hauler.memory.sourceId

    if (sourceId !== undefined) {
      result.set(sourceId, (result.get(sourceId) ?? 0) + 1)
    }
  }

  return result
}

function decrementSourceHaulerCount(counts: Map<Id<Source>, number>, sourceId: Id<Source>): void {
  const count = counts.get(sourceId)

  if (count === undefined || count <= 1) {
    counts.delete(sourceId)
    return
  }

  counts.set(sourceId, count - 1)
}

interface Coordinate {
  readonly x: number
  readonly y: number
}

interface HaulerCoordinationContext {
  readonly occupantByPosition: Map<string, Creep>
  readonly intendedByCreep: Map<string, Coordinate>
  readonly turnedAround: Set<string>
}

export function runHaulerCoordination(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  haulers: readonly Creep[],
  travelingMiners: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
): void {
  const sourceHaulerCounts = countSourceHaulers(haulers)
  const relayEnabled = getBotOptions().speedrun

  finishLogisticsDeliveries(
    logistics,
    haulers,
    sourceStates,
    sourceById,
    sourceHaulerCounts,
    relayEnabled,
  )
  runDeliveryFallbacks(
    room,
    basePlan,
    logistics,
    haulers,
    sourceStates,
    sourceById,
    sourceHaulerCounts,
    relayEnabled,
  )

  if (!relayEnabled) {
    return
  }

  const context = createHaulerCoordinationContext(haulers, travelingMiners)

  resolveTombstoneTurnarounds(context, room, basePlan, logistics, haulers, sourceById)
  resolveRelays(context, room, basePlan, logistics, haulers, sourceById)
  resolvePullChains(context, haulers, travelingMiners)
}

function finishLogisticsDeliveries(
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number>,
  relayEnabled: boolean,
): void {
  const emptiedSuppliers = logistics.emptiedSuppliers

  if (emptiedSuppliers === undefined || emptiedSuppliers.size === 0) {
    return
  }

  for (const hauler of haulers) {
    if (!emptiedSuppliers.has(hauler.name) || !hauler.memory.delivering) {
      continue
    }

    finishDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts, relayEnabled)
  }
}

function runDeliveryFallbacks(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  haulers: readonly Creep[],
  sourceStates: readonly HarvestSourceState[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>,
  sourceHaulerCounts: Map<Id<Source>, number>,
  relayEnabled: boolean,
): void {
  const fallbackTarget = room.storage ?? getStorageContainer(room, basePlan)
  let fallbackFreeCapacity = fallbackTarget?.store.getFreeCapacity(RESOURCE_ENERGY)

  for (const hauler of haulers) {
    if (
      hauler.room.name !== room.name ||
      !isRelaySupplier(hauler) ||
      logistics.handledSuppliers?.has(hauler.name) === true
    ) {
      continue
    }

    const logisticsRuntime = getLogisticsSupplierRuntime(hauler.name)

    if (logisticsRuntime.targetRequestId !== undefined) {
      continue
    }

    const sourceId = hauler.memory.sourceId
    const source = sourceId === undefined ? undefined : sourceById.get(sourceId)

    if (source === undefined || !isAtDeliveryHome(hauler, basePlan, source)) {
      continue
    }

    fallbackFreeCapacity = runHomeFallbackAction(
      room,
      basePlan,
      hauler,
      sourceStates,
      sourceById,
      sourceHaulerCounts,
      relayEnabled,
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
  sourceHaulerCounts: Map<Id<Source>, number>,
  relayEnabled: boolean,
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
          finishDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts, relayEnabled)
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
          finishDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts, relayEnabled)
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
      finishDelivery(hauler, sourceStates, sourceById, sourceHaulerCounts, relayEnabled)
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

function isAtDeliveryHome(hauler: Creep, basePlan: BasePlan, source: HarvestSourceState): boolean {
  const pathStart = source.haulerTravel.loadedPath[0]

  if (pathStart !== undefined && hauler.pos.isEqualTo(pathStart)) {
    return true
  }

  return (
    hauler.pos.roomName === basePlan.roomName &&
    hauler.pos.x === basePlan.storage.x &&
    hauler.pos.y === basePlan.storage.y
  )
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

    const sourceId = hauler.memory.sourceId
    const source = sourceId === undefined ? undefined : sourceById.get(sourceId)

    if (source === undefined || hauler.withdraw(tombstone, RESOURCE_ENERGY) !== OK) {
      continue
    }

    hauler.memory.delivering = true
    delete hauler.memory.searchingEnergy
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
    if (context.turnedAround.has(supplier.name) || relayed.has(supplier.name) || !isRelaySupplier(supplier)) {
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

    const fetcherSourceId = fetcher.memory.sourceId
    const supplierSourceId = supplier.memory.sourceId

    if (fetcherSourceId === undefined || supplierSourceId === undefined) {
      continue
    }

    const fetcherSource = sourceById.get(fetcherSourceId)
    const supplierSource = sourceById.get(supplierSourceId)

    if (
      fetcherSource === undefined ||
      supplierSource === undefined ||
      supplier.transfer(fetcher, RESOURCE_ENERGY) !== OK
    ) {
      continue
    }

    fetcher.memory.sourceId = supplierSourceId
    fetcher.memory.delivering = true
    delete fetcher.memory.searchingEnergy

    supplier.memory.sourceId = fetcherSourceId
    delete supplier.memory.delivering
    delete supplier.memory.searchingEnergy

    const fetcherIntended = context.intendedByCreep.get(fetcher.name)
    const isMutualRelay =
      fetcherIntended !== undefined && fetcherIntended.x === supplier.pos.x && fetcherIntended.y === supplier.pos.y

    if (isMutualRelay) {
      swapKnownPathIndex(fetcher.name, supplier.name)
    } else {
      handoffKnownPathIndex(supplier.name, fetcher.name)
    }

    swapLogisticsSupplierRuntime(fetcher.name, supplier.name)

    requestHaulerMovement(room, basePlan, logistics, fetcher, supplierSource)
    requestHaulerMovement(room, basePlan, logistics, supplier, fetcherSource)
    refreshIntended(context, fetcher)
    refreshIntended(context, supplier)

    relayed.add(fetcher.name)
    relayed.add(supplier.name)
  }
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
    !hauler.memory.delivering &&
    !hauler.memory.searchingEnergy &&
    hauler.memory.sourceId !== undefined &&
    hauler.store.getUsedCapacity() === 0
  )
}

function isRelaySupplier(hauler: Creep): boolean {
  return (
    !hauler.spawning &&
    hauler.memory.delivering === true &&
    hauler.memory.sourceId !== undefined &&
    hauler.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  )
}

function requestHaulerMovement(
  room: Room,
  basePlan: BasePlan,
  logistics: LogisticsState,
  hauler: Creep,
  source: HarvestSourceState,
): void {
  if (!hauler.memory.delivering) {
    moveCreepByPath(hauler, source.haulerTravel.emptyPath, HAULER_PATH_OPTIONS)
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

  if (hauler.room.name === room.name && isAtDeliveryHome(hauler, basePlan, source)) {
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

export function createHaulerBody(room: Room): readonly BodyPartConstant[] | undefined {
  const budget = room.energyAvailable

  if (budget < 100) {
    return undefined
  }

  const unit = [CARRY, MOVE]
  const unitCost = unit.reduce((prev, curr) => prev + BODYPART_COST[curr], 0)

  const maxCount = getBotOptions().speedrun ? SPEEDRUN_HAULER_MAX_CARRY : Math.floor(MAX_CREEP_SIZE / unit.length)

  const carryCount = Math.min(Math.max(1, Math.floor(budget / unitCost)), maxCount)

  const result: BodyPartConstant[] = []

  for (let i = 0; i < carryCount; i++) {
    result.push(...unit)
  }

  return result
}
