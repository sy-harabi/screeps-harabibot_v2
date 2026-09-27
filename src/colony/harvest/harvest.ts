import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { RoomIntel } from "../../world/intel/roomIntel"
import type { LogisticsState } from "../logistics/logistics"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { getMiningPositions, getSourceContainer } from "./miningSite"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { getSourceEconomyStats } from "./sourceEconomyStats"
import { RESERVER_ROLE } from "./reserver"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000

interface HarvestRoomState {
  readonly roomName: string
  readonly intel: RoomIntel
  readonly sources: HarvestSourceState[]

  readonly reservationState: ReservationState

  reservePower: number
}

type ReservationState = "owned" | "none" | "ours" | "foreign"

export interface HarvestSourceState {
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
  if (!harvestRoomPlanStore.isReady() || !intelStore.isReady()) {
    return EMPTY_HARVEST_RESULT
  }

  const colonyName = room.name
  const roomStates = prepareHarvestRoomStates(room)
  const roomByRoomName = new Map<string, HarvestRoomState>(
    roomStates.map((roomState) => [roomState.roomName, roomState] as const),
  )
  const sourceById = new Map<Id<Source>, HarvestSourceState>(sourceStates.map((source) => [source.id, source] as const))

  const miners = getColonyCreeps(context, colonyName, MINER_ROLE)
  const haulers = getColonyCreeps(context, colonyName, HAULER_ROLE)
  const reservers = getColonyCreeps(context, colonyName, RESERVER_ROLE)

  const shouldReserve = room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]

  let hasHarvestIncome = false

  for (const reserver of reservers) {
    const remoteName = reserver.memory.remoteRoomName

    if (remoteName === undefined) {
      continue
    }

    const roomState = roomByRoomName.get(remoteName)

    if (roomState === undefined) {
      continue
    }

    roomState.reservePower += reserver.body.reduce((prev, curr) => prev + (curr.type === CLAIM ? 1 : 0), 0)
  }

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

  let spawnRequested = false

  for (const roomState of roomStates) {
    if (roomState.reservationState === "foreign") {
      continue
    }

    source.carryCapacity = Math.min(source.requiredCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= source.carryCapacity

    const minerRatio = source.harvestPower / source.requiredHarvestPower
    const haulerRatio = source.carryCapacity / source.requiredCarryCapacity

    const sourceEconomyStats = getSourceEconomyStats(
      room,
      source.id,
      source.path,
      source.miningPositions.length,
      source.requiredHarvestPower,
    )

    income += sourceEconomyStats.maxIncome * Math.min(1, minerRatio, haulerRatio)
    maxIncome += sourceEconomyStats.maxIncome
    spawnUsage += sourceEconomyStats.spawnUsage

    if (spawnRequested) {
      continue
    }

    const priorityType = source.roomName === colonyName ? "ownedSource" : "remoteSource"

    if (minerRatio < 1 && minerRatio <= haulerRatio && source.numMiners < source.miningPositions.length) {
      const container = getSourceContainer(source.path)
      const repairContainer =
        hasHarvestIncome && container !== undefined && container.hits < SOURCE_CONTAINER_REPAIR_THRESHOLD

      const targetWork = getTargetMinerWork(room, source) + (repairContainer ? 1 : 0)

      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType,
          order: source.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createMinerBody(room, source.path, targetWork, hasHarvestIncome, { carry: repairContainer }),
        MINER_ROLE,
        { memory: { sourceId: source.id } },
      )

      spawnRequested = true
      continue
    }

    if (haulerRatio < 1) {
      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType,
          order: source.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createHaulerBody(room),
        HAULER_ROLE,
      )

      spawnRequested = true
    }
  }

  runMiners(miners, sourceById)
  runHaulers(colonyName, haulers, sourceStates, sourceById, logistics)

  return { income, maxIncome, spawnUsage }
}

function getReservationState(intel: RoomIntel, username: string): ReservationState {
  if (intel.controller?.owner?.username === username) {
    return "owned"
  }

  const reservation = intel.controller?.reservation

  if (reservation === undefined) {
    return "none"
  }

  return reservation.username === username ? "ours" : "foreign"
}

function getTargetMinerWork(room: Room, source: HarvestSourceState): number {
  if (source.roomName === room.name || room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]) {
    return Math.ceil(SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
  }

  return Math.ceil(SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
}

function prepareHarvestRoomStates(room: Room): HarvestRoomState[] {
  const colonyName = room.name
  const username = room.controller?.owner?.username

  if (username === undefined) {
    return []
  }

  const result: HarvestRoomState[] = []

  for (const roomName of harvestRoomPlanStore.getByColony(colonyName)) {
    const harvestPlan = harvestRoomPlanStore.get(roomName)
    const intel = intelStore.get(roomName)

    if (harvestPlan === undefined || intel === undefined) {
      continue
    }

    const requiredHarvestPower = getRequiredHarvestPower(intel, username)

    const sources: HarvestSourceState[] = []

    for (const sourceIntel of intel.sources) {
      const sourcePlan = harvestPlan.sources.get(sourceIntel.id)

      if (sourcePlan === undefined) {
        continue
      }

      const miningPositions = getMiningPositions(roomName, sourceIntel.coordinate, sourcePlan.path)

      sources.push({
        id: sourceIntel.id,
        roomName,
        path: sourcePlan.path,
        miningPositions,
        requiredHarvestPower,
        requiredCarryCapacity: sourcePlan.path.length * 2 * requiredHarvestPower,

        harvestPower: 0,
        harvestingPower: 0,
        numMiners: 0,

        carryCapacity: 0,
        pendingEnergy: 0,
      })
    }

    sources.sort((left, right) => left.path.length - right.path.length)

    const reservationState = getReservationState(intel, username)

    const roomState = {
      roomName,
      intel,
      reservationState,
      sources,

      reservePower: 0,
    }

    result.push(roomState)
  }

  result.sort((left, right) => {
    const leftRemote = left.roomName !== colonyName
    const rightRemote = right.roomName !== colonyName

    return (
      Number(leftRemote) - Number(rightRemote) ||
      left.sources[0].path.length - right.sources[0].path.length ||
      left.roomName.localeCompare(right.roomName)
    )
  })
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
