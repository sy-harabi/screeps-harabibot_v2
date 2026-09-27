import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { RoomIntel } from "../../world/intel/roomIntel"
import type { LogisticsState } from "../logistics/logistics"
import { harvestRoomDataStore } from "./harvestDataStore"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { getMiningPositions, getSourceContainer } from "./harvestSource"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { getSourceEconomy } from "./sourceEconomy"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000

export interface HarvestSource {
  readonly id: Id<Source>
  readonly roomName: string
  readonly path: readonly RoomPosition[]
  readonly miningPositions: readonly RoomPosition[]
  readonly requiredHarvestPower: number
  readonly requiredCarryCapacity: number

  harvestPower: number
  harvestingPower: number
  numMiners: number

  carryCapacity: number
  pendingEnergy: number
}

export interface HarvestResult {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
}

const ROLES_BY_PRIORITY = [MINER_ROLE, HAULER_ROLE]
const EMPTY_HARVEST_RESULT: HarvestResult = { income: 0, maxIncome: 0, spawnUsage: 0 }

export function runHarvest(room: Room, context: TickContext, logistics: LogisticsState): HarvestResult {
  if (!harvestRoomDataStore.isReady() || !intelStore.isReady()) {
    return EMPTY_HARVEST_RESULT
  }

  const colonyName = room.name
  const sources = prepareHarvestSources(room)
  const sourceById = new Map<Id<Source>, HarvestSource>(sources.map((source) => [source.id, source] as const))
  const miners = getColonyCreeps(context, colonyName, MINER_ROLE)
  const haulers = getColonyCreeps(context, colonyName, HAULER_ROLE)

  let hasHarvestIncome = false

  for (const miner of miners) {
    const sourceId = miner.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined || source.requiredHarvestPower <= 0) {
      continue
    }

    const replacementLeadTime = getMinerReplacementLeadTime(miner, source.path)
    const harvestPower = miner.getActiveBodyparts(WORK) * HARVEST_POWER

    if (harvestPower > 0) {
      hasHarvestIncome = true
    }

    if ((miner.ticksToLive ?? CREEP_LIFE_TIME) > replacementLeadTime) {
      source.harvestPower += harvestPower
      source.numMiners++
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
  const requesterId = "harvest:" + colonyName
  const assignment = {
    type: "colony" as const,
    colonyName,
  }

  let income = 0
  let maxIncome = 0
  let spawnUsage = 0

  for (const source of sources) {
    if (source.requiredHarvestPower <= 0) {
      continue
    }

    source.carryCapacity = Math.min(source.requiredCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= source.carryCapacity

    const minerRatio = source.harvestPower / source.requiredHarvestPower
    const haulerRatio = source.carryCapacity / source.requiredCarryCapacity

    const sourceEconomy = getSourceEconomy(
      room,
      source.id,
      source.path,
      source.miningPositions.length,
      source.requiredHarvestPower,
    )

    income += sourceEconomy.maxIncome * Math.min(1, minerRatio, haulerRatio)
    maxIncome += sourceEconomy.maxIncome
    spawnUsage += sourceEconomy.spawnUsage

    if (minerRatio < 1 && minerRatio <= haulerRatio && source.numMiners < source.miningPositions.length) {
      const container = getSourceContainer(source.path)
      const repairContainer =
        hasHarvestIncome && container !== undefined && container.hits < SOURCE_CONTAINER_REPAIR_THRESHOLD

      const targetWork = Math.ceil(source.requiredHarvestPower / HARVEST_POWER) + (repairContainer ? 1 : 0)

      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType: "ownedSource",
          order: source.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createMinerBody(room, source.path, targetWork, hasHarvestIncome, { carry: repairContainer }),
        MINER_ROLE,
        { memory: { sourceId: source.id } },
      )
    } else if (haulerRatio < 1) {
      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType: "ownedSource",
          order: source.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createHaulerBody(room),
        HAULER_ROLE,
      )
    }
  }

  runMiners(miners, sourceById)
  runHaulers(colonyName, haulers, sources, sourceById, logistics)

  return { income, maxIncome, spawnUsage }
}

function prepareHarvestSources(room: Room): HarvestSource[] {
  const colonyName = room.name
  const username = room.controller?.owner?.username

  if (username === undefined) {
    return []
  }

  const result: HarvestSource[] = []

  for (const roomName of harvestRoomDataStore.getByColony(colonyName)) {
    const harvestData = harvestRoomDataStore.get(roomName)
    const intel = intelStore.get(roomName)

    if (harvestData === undefined || intel === undefined) {
      continue
    }

    const requiredHarvestPower = getRequiredHarvestPower(intel, username)

    for (const [sourceId, sourceData] of harvestData.sources) {
      const sourceIntel = intel.sources.find((source) => source.id === sourceId)

      if (sourceIntel === undefined) {
        continue
      }

      const miningPositions = getMiningPositions(roomName, sourceIntel.coordinate, sourceData.path)

      result.push({
        id: sourceId,
        roomName,
        path: sourceData.path,
        miningPositions,
        requiredHarvestPower,
        requiredCarryCapacity: sourceData.path.length * 2 * requiredHarvestPower,

        harvestPower: 0,
        harvestingPower: 0,
        numMiners: 0,

        carryCapacity: 0,
        pendingEnergy: 0,
      })
    }
  }

  result.sort((left, right) => left.path.length - right.path.length || left.id.localeCompare(right.id))

  return result
}

function getRequiredHarvestPower(intel: RoomIntel, username: string): number {
  const controller = intel.controller

  if (controller === undefined) {
    return 0
  }

  if (controller.owner !== undefined) {
    return controller.owner.username === username ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME : 0
  }

  if (controller.reservation !== undefined) {
    return controller.reservation.username === username ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME : 0
  }

  return SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME
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
