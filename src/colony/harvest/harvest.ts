import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { RoomIntel } from "../../world/intel/roomIntel"
import type { LogisticsState } from "../logistics/logistics"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { getHarvestRuntime, type RemoteControllerRuntime } from "./harvestRuntime"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { getMiningPositions, getSourceContainer } from "./miningSite"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { createReserverBody, RESERVER_ROLE, runReserver } from "./reserver"
import { getSourceEconomyStats } from "./sourceEconomyStats"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000
const RESERVER_REPLACEMENT_BUFFER = 20
const RESERVATION_RESTART_MARGIN = 200
const TARGET_RESERVE_POWER = 2

interface HarvestRoomState {
  readonly roomName: string
  readonly intel: RoomIntel
  readonly sources: HarvestSourceState[]

  readonly reservationState: ReservationState
  readonly reserverLeadTime?: number

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

const ROLES_BY_PRIORITY = [MINER_ROLE, HAULER_ROLE, RESERVER_ROLE]
const EMPTY_HARVEST_RESULT: HarvestResult = { income: 0, maxIncome: 0, spawnUsage: 0 }

export function runHarvest(
  room: Room,
  basePlan: BasePlan,
  context: TickContext,
  logistics: LogisticsState,
): HarvestResult {
  if (!harvestRoomPlanStore.isReady() || !intelStore.isReady()) {
    return EMPTY_HARVEST_RESULT
  }

  const colonyName = room.name
  const reserverBody = createReserverBody(room)
  const roomStates = prepareHarvestRoomStates(room, basePlan, reserverBody)

  const roomByName = new Map<string, HarvestRoomState>()
  const sourceStates: HarvestSourceState[] = []
  const sourceById = new Map<Id<Source>, HarvestSourceState>()

  for (const roomState of roomStates) {
    roomByName.set(roomState.roomName, roomState)

    for (const source of roomState.sources) {
      sourceStates.push(source)
      sourceById.set(source.id, source)
    }
  }

  const miners = getColonyCreeps(context, colonyName, MINER_ROLE)
  const haulers = getColonyCreeps(context, colonyName, HAULER_ROLE)
  const reservers = getColonyCreeps(context, colonyName, RESERVER_ROLE)

  for (const reserver of reservers) {
    const remoteRoomName = reserver.memory.remoteRoomName

    if (remoteRoomName === undefined) {
      continue
    }

    const roomState = roomByName.get(remoteRoomName)
    const leadTime = roomState?.reserverLeadTime

    if (roomState === undefined || leadTime === undefined) {
      continue
    }

    if (reserver.spawning || (reserver.ticksToLive ?? 0) >= leadTime) {
      roomState.reservePower += reserver.getActiveBodyparts(CLAIM)
    }
  }

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
  let spawnRequested = false

  const requestReserver = (roomState: HarvestRoomState): void => {
    if (spawnRequested || reserverBody === undefined || !needsReserver(roomState)) {
      return
    }

    const firstSource = roomState.sources[0]

    if (firstSource === undefined) {
      return
    }

    requestSpawn(
      {
        requesterId,
        spawnRoomName: colonyName,
        assignment,
        priorityType: "remoteSource",
        order: firstSource.path.length,
        rolesByPriority: ROLES_BY_PRIORITY,
      },
      reserverBody,
      RESERVER_ROLE,
      {
        memory: {
          remoteRoomName: roomState.roomName,
        },
      },
    )

    spawnRequested = true
  }

  const processSource = (source: HarvestSourceState): boolean => {
    if (source.requiredHarvestPower <= 0) {
      return false
    }

    source.carryCapacity = Math.min(source.requiredCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= source.carryCapacity

    const minerRatio = source.harvestPower / source.requiredHarvestPower
    const haulerRatio = source.carryCapacity / source.requiredCarryCapacity
    const targetMinerWork = getTargetMinerWork(room, source)

    const sourceEconomyStats = getSourceEconomyStats(
      room,
      source.id,
      source.path,
      source.miningPositions.length,
      source.requiredHarvestPower,
      targetMinerWork,
    )

    income += sourceEconomyStats.maxIncome * Math.min(1, minerRatio, haulerRatio)
    maxIncome += sourceEconomyStats.maxIncome
    spawnUsage += sourceEconomyStats.spawnUsage

    if (!spawnRequested) {
      const priorityType = source.roomName === colonyName ? "ownedSource" : "remoteSource"

      if (minerRatio < 1 && minerRatio <= haulerRatio && source.numMiners < source.miningPositions.length) {
        const container = getSourceContainer(source.path)
        const repairContainer =
          hasHarvestIncome && container !== undefined && container.hits < SOURCE_CONTAINER_REPAIR_THRESHOLD

        const targetWork = targetMinerWork + (repairContainer ? 1 : 0)

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
      } else if (haulerRatio < 1) {
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

    return minerRatio >= 1 && haulerRatio >= 1
  }

  for (const roomState of roomStates) {
    switch (roomState.reservationState) {
      case "owned":
        for (const source of roomState.sources) {
          processSource(source)
        }
        break

      case "none": {
        const firstSource = roomState.sources[0]

        if (firstSource === undefined) {
          break
        }

        const firstSourceReady = processSource(firstSource)

        if (firstSourceReady) {
          requestReserver(roomState)
        }

        for (let i = 1; i < roomState.sources.length; i++) {
          processSource(roomState.sources[i])
        }
        break
      }

      case "ours":
        requestReserver(roomState)

        for (const source of roomState.sources) {
          processSource(source)
        }
        break

      case "foreign":
        requestReserver(roomState)
        break
    }
  }

  for (const reserver of reservers) {
    const remoteRoomName = reserver.memory.remoteRoomName

    if (remoteRoomName !== undefined && roomByName.has(remoteRoomName)) {
      runReserver(reserver, remoteRoomName)
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

function getReservationTicks(roomState: HarvestRoomState): number {
  if (roomState.reservationState !== "ours") {
    return 0
  }

  const endTick = roomState.intel.controller?.reservation?.endTick

  return endTick === undefined ? 0 : Math.max(0, endTick - Game.time)
}

function needsReserver(roomState: HarvestRoomState): boolean {
  const leadTime = roomState.reserverLeadTime

  if (leadTime === undefined || roomState.reservePower >= TARGET_RESERVE_POWER) {
    return false
  }

  return getReservationTicks(roomState) - leadTime < RESERVATION_RESTART_MARGIN
}

function getTargetMinerWork(room: Room, source: HarvestSourceState): number {
  if (source.roomName === room.name || room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]) {
    return Math.ceil(SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
  }

  return Math.ceil(SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
}

function prepareHarvestRoomStates(
  room: Room,
  basePlan: BasePlan,
  reserverBody: readonly BodyPartConstant[] | undefined,
): HarvestRoomState[] {
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

    sources.sort((left, right) => left.path.length - right.path.length || left.id.localeCompare(right.id))

    const reservationState = getReservationState(intel, username)
    let reserverLeadTime: number | undefined

    if (roomName !== colonyName && reserverBody !== undefined) {
      const controllerRuntime = getRemoteControllerRuntime(basePlan, roomName, intel, sources)

      if (controllerRuntime !== undefined) {
        reserverLeadTime =
          reserverBody.length * CREEP_SPAWN_TIME + controllerRuntime.travelTicks + RESERVER_REPLACEMENT_BUFFER
      }
    }

    result.push({
      roomName,
      intel,
      sources,
      reservationState,
      reserverLeadTime,
      reservePower: 0,
    })
  }

  result.sort((left, right) => {
    const leftRemote = left.roomName !== colonyName
    const rightRemote = right.roomName !== colonyName
    const leftDistance = left.sources[0]?.path.length ?? Infinity
    const rightDistance = right.sources[0]?.path.length ?? Infinity

    return (
      Number(leftRemote) - Number(rightRemote) ||
      leftDistance - rightDistance ||
      left.roomName.localeCompare(right.roomName)
    )
  })

  return result
}

function getRemoteControllerRuntime(
  basePlan: BasePlan,
  roomName: string,
  intel: RoomIntel,
  sources: readonly HarvestSourceState[],
): RemoteControllerRuntime | undefined {
  const controller = intel.controller

  if (controller === undefined) {
    return
  }

  const runtime = getHarvestRuntime(basePlan.roomName)

  runtime.remoteControllersByRoom ??= new Map()

  const cached = runtime.remoteControllersByRoom.get(roomName)

  if (cached !== undefined) {
    return cached
  }

  const allowedRooms = new Set<string>([basePlan.roomName, roomName])

  for (const source of sources) {
    for (const pos of source.path) {
      allowedRooms.add(pos.roomName)
    }
  }

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(controller.coordinate.x, controller.coordinate.y, roomName),
      range: 1,
    },
    {
      plainCost: 1,
      swampCost: 5,
      maxRooms: allowedRooms.size,
      maxOps: allowedRooms.size * 2000,
      roomCallback: (currentRoomName) => {
        if (!allowedRooms.has(currentRoomName)) {
          return false
        }

        return getBaseRoomCostMatrix(currentRoomName)?.clone() ?? new PathFinder.CostMatrix()
      },
    },
  )

  if (result.incomplete) {
    return
  }

  const controllerRuntime: RemoteControllerRuntime = {
    travelTicks: result.cost,
    availablePositions: countControllerPositions(roomName, controller.coordinate.x, controller.coordinate.y),
  }

  runtime.remoteControllersByRoom.set(roomName, controllerRuntime)

  return controllerRuntime
}

function countControllerPositions(roomName: string, controllerX: number, controllerY: number): number {
  const terrain = Game.map.getRoomTerrain(roomName)
  let result = 0

  for (let x = Math.max(0, controllerX - 1); x <= Math.min(49, controllerX + 1); x++) {
    for (let y = Math.max(0, controllerY - 1); y <= Math.min(49, controllerY + 1); y++) {
      if (x === controllerX && y === controllerY) {
        continue
      }

      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        result++
      }
    }
  }

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
