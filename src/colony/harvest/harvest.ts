import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { LogisticsState } from "../logistics/logistics"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { findOwnedSourcePath } from "./ownedSources"
import { remoteRoomDataStore } from "./remoteRoomDataStore"
import { runRemoteReservers } from "./reserver"
import { createHarvestSourceData, getSourceContainer, type HarvestSourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"
import { getSourceEconomy } from "./sourceEconomy"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000
const OWNED_SOURCE_INCOME = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME
const NEUTRAL_SOURCE_INCOME = SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME

export interface SourceState {
  readonly data: HarvestSourceData

  harvestPower: number
  harvestingPower: number
  requiredHarvestPower: number

  numMiners: number

  requiredCarryCapacity: number
  carryCapacity: number
  pendingEnergy: number
}

export interface HarvestResult {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
}

const ROLES_BY_PRIORITY = [MINER_ROLE, HAULER_ROLE]

export function runHarvest(
  room: Room,
  basePlan: BasePlan,
  context: TickContext,
  logistics: LogisticsState,
): HarvestResult {
  if (!sourceDataStore.isReady() || !remoteRoomDataStore.isReady()) {
    return {
      income: 0,
      maxIncome: 0,
      spawnUsage: 0,
    }
  }

  const colonyName = room.name
  const sourceDataById = getHarvestSourceDataById(colonyName, basePlan)
  const sourceOrder = getSourceOrder(colonyName, sourceDataById)
  const sourceStateById = new Map<Id<Source>, SourceState>()
  const miners = getColonyCreeps(context, colonyName, MINER_ROLE)
  const haulers = getColonyCreeps(context, colonyName, HAULER_ROLE)

  let hasHarvestIncome = false

  for (const miner of miners) {
    const sourceId = miner.memory.sourceId

    if (!sourceId) {
      continue
    }

    const sourceState = ensureSourceState(room, sourceDataById, sourceStateById, sourceId)

    if (sourceState === undefined) {
      continue
    }

    const replacementLeadTime = getMinerReplacementLeadTime(miner, sourceState.data.path)
    const harvestPower = miner.getActiveBodyparts(WORK) * HARVEST_POWER

    if (harvestPower > 0) {
      hasHarvestIncome = true
    }

    if ((miner.ticksToLive ?? CREEP_LIFE_TIME) > replacementLeadTime) {
      sourceState.harvestPower += harvestPower
      sourceState.numMiners++
    }
  }

  let totalCarryCapacity = 0

  for (const hauler of haulers) {
    const replacementLeadTime = hauler.body.length * CREEP_SPAWN_TIME + 10

    if ((hauler.ticksToLive ?? CREEP_LIFE_TIME) > replacementLeadTime) {
      totalCarryCapacity += hauler.getActiveBodyparts(CARRY) * CARRY_CAPACITY
    }
  }

  let carryCapacityLeft = totalCarryCapacity
  const requesterId = `harvest:${colonyName}`
  const assignment = {
    type: "colony" as const,
    colonyName,
  }

  let income = 0
  let maxIncome = 0
  let spawnUsage = 0

  for (const sourceId of sourceOrder) {
    const sourceState = ensureSourceState(room, sourceDataById, sourceStateById, sourceId)

    if (sourceState === undefined) {
      continue
    }

    const priorityType = sourceState.data.roomName === colonyName ? "ownedSource" : "remoteSource"

    sourceState.carryCapacity = Math.min(sourceState.requiredCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= sourceState.carryCapacity

    const minerRatio = sourceState.harvestPower / sourceState.requiredHarvestPower
    const haulerRatio = sourceState.carryCapacity / sourceState.requiredCarryCapacity

    const targetMinerWork = getTargetMinerWork(room, sourceState)
    const sourceEconomy = getSourceEconomy(room, sourceState.data, sourceState.requiredHarvestPower, targetMinerWork)

    income += sourceEconomy.maxIncome * Math.min(1, minerRatio, haulerRatio)
    maxIncome += sourceEconomy.maxIncome
    spawnUsage += sourceEconomy.spawnUsage

    if (
      minerRatio < 1 &&
      minerRatio <= haulerRatio &&
      sourceState.numMiners < sourceState.data.miningPositions.length
    ) {
      const container = getSourceContainer(sourceState.data)
      const repairContainer =
        hasHarvestIncome && container !== undefined && container.hits < SOURCE_CONTAINER_REPAIR_THRESHOLD

      const targetWork = targetMinerWork + (repairContainer ? 1 : 0)

      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType,
          order: sourceState.data.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createMinerBody(room, sourceState.data.path, targetWork, hasHarvestIncome, { carry: repairContainer }),
        MINER_ROLE,
        { memory: { sourceId } },
      )
    } else if (haulerRatio < 1) {
      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType,
          order: sourceState.data.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createHaulerBody(room),
        HAULER_ROLE,
      )
    }
  }

  runRemoteReservers(room, context, sourceStateById)

  runMiners(miners, sourceStateById)
  runHaulers(colonyName, haulers, sourceOrder, sourceStateById, logistics)

  return { income, maxIncome, spawnUsage }
}

function getHarvestSourceDataById(colonyName: string, basePlan: BasePlan): Map<Id<Source>, HarvestSourceData> {
  const result = new Map<Id<Source>, HarvestSourceData>()
  const runtime = getHarvestRuntime(colonyName)

  runtime.ownedPathsBySourceId ??= new Map()

  for (const sourceData of sourceDataStore.getByRoom(colonyName).values()) {
    let path = runtime.ownedPathsBySourceId.get(sourceData.sourceId)

    if (path === undefined) {
      path = findOwnedSourcePath(basePlan, sourceData.sourceId)

      if (path === undefined) {
        continue
      }

      runtime.ownedPathsBySourceId.set(sourceData.sourceId, path)
    }

    result.set(sourceData.sourceId, createHarvestSourceData(sourceData, colonyName, path))
  }

  for (const remoteName of remoteRoomDataStore.getByColony(colonyName)) {
    const remote = remoteRoomDataStore.get(remoteName)

    if (remote === undefined) {
      continue
    }

    for (const remoteSource of remote.sources) {
      const sourceDataResult = sourceDataStore.get(remoteSource.sourceId)

      if (sourceDataResult.status !== "ready") {
        continue
      }

      result.set(remoteSource.sourceId, createHarvestSourceData(sourceDataResult.value, colonyName, remoteSource.path))
    }
  }

  return result
}

function getMinerReplacementLeadTime(miner: Creep, path: readonly RoomPosition[]): number {
  let workCount = 0
  let moveCount = 0

  for (const part of miner.body) {
    if (part.type === WORK) {
      workCount++
    } else if (part.type === MOVE) {
      moveCount++
    }
  }

  const travelTicks = estimatePathTravelTicks(path, moveCount, workCount)

  return miner.body.length * CREEP_SPAWN_TIME + travelTicks + 10
}

function ensureSourceState(
  room: Room,
  sourceDataById: ReadonlyMap<Id<Source>, HarvestSourceData>,
  sourceStateById: Map<Id<Source>, SourceState>,
  sourceId: Id<Source>,
): SourceState | undefined {
  const sourceData = sourceDataById.get(sourceId)

  if (!sourceData) {
    return
  }

  let sourceState = sourceStateById.get(sourceId)
  const requiredHarvestPower = getRequiredHarvestPower(room, sourceData)

  if (sourceState === undefined) {
    sourceState = {
      data: sourceData,

      harvestPower: 0,
      harvestingPower: 0,
      requiredHarvestPower,
      numMiners: 0,

      requiredCarryCapacity: sourceData.path.length * 2 * requiredHarvestPower,
      carryCapacity: 0,
      pendingEnergy: 0,
    }

    sourceStateById.set(sourceId, sourceState)
  }

  return sourceState
}

function getRequiredHarvestPower(room: Room, sourceData: HarvestSourceData): number {
  if (sourceData.roomName === room.name) {
    return OWNED_SOURCE_INCOME
  }

  const reservation = intelStore.get(sourceData.roomName)?.controller?.reservation
  const username = room.controller?.owner?.username

  if (
    reservation !== undefined &&
    reservation.endTick > Game.time &&
    username !== undefined &&
    reservation.username === username
  ) {
    return OWNED_SOURCE_INCOME
  }

  return NEUTRAL_SOURCE_INCOME
}

function getTargetMinerWork(room: Room, sourceState: SourceState): number {
  if (sourceState.data.roomName === room.name) {
    return Math.ceil(sourceState.requiredHarvestPower / HARVEST_POWER)
  }

  return room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE] ? 5 : 3
}

function getSourceOrder(colonyName: string, sourceDataById: ReadonlyMap<Id<Source>, HarvestSourceData>): Id<Source>[] {
  const runtime = getHarvestRuntime(colonyName)

  if (runtime.sourceOrder !== undefined) {
    return runtime.sourceOrder
  }

  const sourceOrder = [...sourceDataById.values()]
    .sort((left, right) => {
      const leftOwned = left.roomName === colonyName
      const rightOwned = right.roomName === colonyName

      if (leftOwned !== rightOwned) {
        return leftOwned ? -1 : 1
      }

      return left.path.length - right.path.length
    })
    .map((sourceData) => sourceData.sourceId)

  runtime.sourceOrder = sourceOrder

  return sourceOrder
}
