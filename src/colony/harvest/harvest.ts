import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getDefaultRoomCostMatrix } from "../../capabilities/movement/defaultRoomCostMatrix"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { getBotOptions } from "../../options/botOptions"
import { intelStore } from "../../world/intel/intelStore"
import type { LogisticsState } from "../logistics/logistics"
import { getHarvestSourceMemory } from "./harvestMemory"
import {
  getRemoteMaintenanceSourceId,
  inspectRemoteMaintenanceSource,
  reconcileRemoteMaintenance,
} from "./remoteMaintenance"
import { planHarvest } from "./harvestRoomPlanner"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { getHarvestRuntime, type HaulerTravelRuntime, type RemoteControllerRuntime } from "./harvestRuntime"
import {
  countSourceHaulers,
  createHaulerBody,
  getRequiredCarryCapacity,
  HAULER_ROLE,
  runHaulersPhase1,
  type HaulerProfile,
} from "./hauler"
import { getMiningPositions, getSourceContainer } from "./miningSite"
import { createMinerBody, getMinerReplacementLeadTime, MINER_ROLE, runMiners } from "./miner"
import { createReserverBody, RESERVER_ROLE, runReserver } from "./reserver"
import { getSourceEconomyStats } from "./sourceEconomyStats"
import { visualizeHarvest, type HarvestVisualReservationRow, type HarvestVisualSourceRow } from "./harvestVisual"
import { visualizeHarvestPaths } from "./harvestPathVisual"
import { getHaulerTravelRuntime } from "./haulerTravel"
import {
  createRemoteBuilderBody,
  getRemoteBuilderCarryCapacity,
  getRemoteBuilderCarryEquivalent,
  REMOTE_BUILDER_ROLE,
  REMOTE_BUILDER_TARGET_WORK,
  runRemoteBuilders,
} from "./remoteBuilder"
import {
  activateRemoteConstructionSource,
  areRemoteRoadsEnabled,
  runRemoteConstructionSource,
  type RemoteConstructionSourceState,
} from "./remoteConstruction"
import { createRemoteRepairerBody, REMOTE_REPAIRER_ROLE, runRemoteRepairers } from "./remoteRepairer"
import { type RoomIntel } from "../../world/intel/roomIntel"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000
const RESERVER_REPLACEMENT_BUFFER = 20
const RESERVATION_RESTART_MARGIN = 200
const TARGET_RESERVE_POWER = 2
const REMOTE_CONSTRUCTION_BATCH_SIZE = 2

interface HarvestRoomState {
  readonly roomName: string
  readonly intel: RoomIntel
  readonly sources: HarvestSourceState[]

  readonly reservationState: ReservationState
  readonly controllerTravelTicks?: number
  readonly reserverLeadTime?: number

  reservePower: number
  hasReserver: boolean
}

type ReservationState = "owned" | "none" | "ours" | "foreign"

interface HarvestSourceResult {
  readonly minerRatio: number
  readonly haulerRatio: number
  readonly ready: boolean
}

export interface HarvestSourceState {
  readonly id: Id<Source>
  readonly roomName: string

  readonly path: readonly RoomPosition[]
  readonly haulerTravel: HaulerTravelRuntime
  readonly useRoadPath: boolean
  readonly haulerCycleTravelTicks: number
  readonly miningPositions: readonly RoomPosition[]

  readonly requiredHarvestPower: number
  readonly requiredCarryCapacity: number
  readonly sourceObject?: Source
  readonly container?: StructureContainer
  readonly containerEnergy: number
  readonly droppedEnergy: number
  readonly largestDroppedEnergy?: Resource<ResourceConstant>

  sustainableHarvestPower: number
  activeHarvestPower: number
  numMiners: number

  remoteBuilderWorkNeeded?: number
  remoteConstructionTarget?: RoomPosition

  builderCarryEquivalent?: number
  remoteBuilderCarryCapacity?: number
  remoteRepairerCarryCapacity?: number

  carryCapacity: number
  pendingEnergy: number
}

export interface HaulerSpeedrunState {
  readonly travelingMiners: Creep[]
  readonly sourceHaulerCounts: Map<Id<Source>, number>
}

export interface HaulerPhase2State {
  readonly haulers: readonly Creep[]
  readonly sourceStates: readonly HarvestSourceState[]
  readonly sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>
  readonly speedrun?: HaulerSpeedrunState
}

export interface HarvestResult {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
  readonly activeSourcePaths?: readonly (readonly RoomPosition[])[]
  readonly haulerPhase2?: HaulerPhase2State
}

const ROLES_BY_PRIORITY = [MINER_ROLE, REMOTE_REPAIRER_ROLE, HAULER_ROLE, RESERVER_ROLE, REMOTE_BUILDER_ROLE]
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
  const colonyPlan = harvestRoomPlanStore.get(colonyName)

  if (colonyPlan === undefined || colonyPlan.basePlanRevision !== basePlan.revision) {
    planHarvest(colonyName, basePlan)
  }

  const options = getBotOptions()
  const reserverBody = createReserverBody(room)

  const roomStates = prepareHarvestRoomStates(room, basePlan, reserverBody, options.speedrun)

  const roomByName = new Map<string, HarvestRoomState>()
  const sourceStates: HarvestSourceState[] = []
  const sourceById = new Map<Id<Source>, HarvestSourceState>()
  const sourceIndexById = new Map<Id<Source>, number>()

  const remoteBuildersBySource = new Map<Id<Source>, Creep[]>()
  const unassignedRemoteBuilders: Creep[] = []
  const remoteConstructionBySource = new Map<Id<Source>, RemoteConstructionSourceState>()

  let activeRemoteConstructionCount = 0

  for (const roomState of roomStates) {
    roomByName.set(roomState.roomName, roomState)

    for (let i = 0; i < roomState.sources.length; i++) {
      const source = roomState.sources[i]
      sourceStates.push(source)
      sourceById.set(source.id, source)
      sourceIndexById.set(source.id, i)
    }
  }

  reconcileRemoteMaintenance(room, sourceStates)

  const haulerProfile: HaulerProfile = !options.speedrun && room.memory.use21Hauler ? "2:1" : "1:1"

  const miners = getColonyCreeps(context, colonyName, MINER_ROLE)
  const haulers = getColonyCreeps(context, colonyName, HAULER_ROLE)
  const reservers = getColonyCreeps(context, colonyName, RESERVER_ROLE)
  const remoteBuilders = getColonyCreeps(context, colonyName, REMOTE_BUILDER_ROLE)
  const remoteRepairers = getColonyCreeps(context, colonyName, REMOTE_REPAIRER_ROLE)
  const speedrunState: HaulerSpeedrunState | undefined = options.speedrun
    ? {
        travelingMiners: [],
        sourceHaulerCounts: countSourceHaulers(haulers),
      }
    : undefined

  for (const reserver of reservers) {
    const remoteRoomName = reserver.memory.remoteRoomName

    if (remoteRoomName === undefined) {
      continue
    }

    const roomState = roomByName.get(remoteRoomName)

    if (roomState === undefined) {
      continue
    }

    roomState.hasReserver = true

    const leadTime = roomState.reserverLeadTime

    if (leadTime !== undefined && (reserver.spawning || (reserver.ticksToLive ?? 0) >= leadTime)) {
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
      source.sustainableHarvestPower += harvestPower
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

  for (const builder of remoteBuilders) {
    const sourceId = builder.memory.sourceId

    if (sourceId === undefined) {
      unassignedRemoteBuilders.push(builder)
      continue
    }

    if (!sourceById.has(sourceId)) {
      delete builder.memory.sourceId
      unassignedRemoteBuilders.push(builder)
      continue
    }

    const builders = remoteBuildersBySource.get(sourceId)

    if (builders === undefined) {
      remoteBuildersBySource.set(sourceId, [builder])
    } else {
      builders.push(builder)
    }
  }

  for (const roomState of roomStates) {
    if (roomState.reservationState !== "ours") {
      continue
    }

    for (const source of roomState.sources) {
      const remoteConstruction = runRemoteConstructionSource(room, source.id, source.path)

      remoteConstructionBySource.set(source.id, remoteConstruction)

      if (remoteConstruction.active) {
        activeRemoteConstructionCount++
      }

      if (!remoteConstruction.complete) {
        continue
      }

      const builders = remoteBuildersBySource.get(source.id)

      if (builders === undefined) {
        continue
      }

      for (const builder of builders) {
        delete builder.memory.sourceId
        unassignedRemoteBuilders.push(builder)
      }

      remoteBuildersBySource.delete(source.id)
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
  const activeSourcePaths: (readonly RoomPosition[])[] = []
  const visualSourceRows: HarvestVisualSourceRow[] = []
  const visualReservationRows: HarvestVisualReservationRow[] = []
  const remoteConstructionCandidates: HarvestSourceState[] = []
  let haulerScore11 = 0
  let haulerScore21 = 0
  let hasHaulerProfileScore = false

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

  const requestRemoteRepairer = (source: HarvestSourceState): void => {
    if (spawnRequested || remoteRepairers.length > 0) {
      return
    }

    requestSpawn(
      {
        requesterId,
        spawnRoomName: colonyName,
        assignment,
        priorityType: "remoteSource",
        order: source.path.length,
        rolesByPriority: ROLES_BY_PRIORITY,
      },
      () => createRemoteRepairerBody(room),
      REMOTE_REPAIRER_ROLE,
    )

    spawnRequested = true
  }

  const applyReservationUpkeep = (roomState: HarvestRoomState, firstSourceReady = false): void => {
    if (!isReservationLifecycleActive(roomState, firstSourceReady)) {
      return
    }

    const upkeep = getReservationUpkeep(roomState)

    income -= upkeep.energy
    maxIncome -= upkeep.energy
    spawnUsage += upkeep.spawnUsage

    visualReservationRows.push({
      roomName: roomState.roomName,
      upkeep: upkeep.energy,
      spawnUsage: upkeep.spawnUsage,
    })
  }

  const processSource = (source: HarvestSourceState, allowMaintenanceStart = false): HarvestSourceResult => {
    if (source.requiredHarvestPower <= 0) {
      return { minerRatio: 0, haulerRatio: 0, ready: false }
    }

    if (source.roomName === colonyName || source.sustainableHarvestPower > 0) {
      activeSourcePaths.push(source.path)
    }

    const requiredHaulerCarryCapacity = Math.max(0, source.requiredCarryCapacity - (source.builderCarryEquivalent ?? 0))

    source.carryCapacity = Math.min(requiredHaulerCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= source.carryCapacity

    const minerRatio = source.sustainableHarvestPower / source.requiredHarvestPower
    const haulerNeedRatio = requiredHaulerCarryCapacity <= 0 ? 1 : source.carryCapacity / requiredHaulerCarryCapacity
    const haulerRatio = source.requiredCarryCapacity <= 0 ? 1 : source.carryCapacity / source.requiredCarryCapacity
    const ready = haulerRatio >= 1

    if (allowMaintenanceStart && ready) {
      inspectRemoteMaintenanceSource(room, source)
    }

    if (!options.speedrun && !room.memory.use21Hauler && requiredHaulerCarryCapacity > 0 && haulerNeedRatio > 0) {
      const cycle11 = source.haulerCycleTravelTicks
      const cycle21 = source.useRoadPath ? source.haulerCycleTravelTicks : source.haulerTravel.cycleTravelTicks21

      haulerScore11 += source.requiredHarvestPower * cycle11 * 2
      haulerScore21 += source.requiredHarvestPower * cycle21 * 1.5
      hasHaulerProfileScore = true
    }

    const targetMinerWork = getTargetMinerWork(room, source)
    const container = source.container

    const sourceEconomyStats = getSourceEconomyStats(
      room,
      source.id,
      source.path,
      source.miningPositions.length,
      source.requiredHarvestPower,
      targetMinerWork,
      container !== undefined,
      source.haulerCycleTravelTicks,
      haulerProfile,
      options.speedrun ? source.haulerTravel.emptyPath.length : undefined,
    )

    let sourceIncome: number | undefined
    let sourceMaxIncome: number | undefined
    let sourceSpawnUsage: number | undefined
    let actualHaulerUpkeep: number | undefined

    if (haulerRatio > 0) {
      const productionRatio = Math.min(1, minerRatio, haulerRatio)

      actualHaulerUpkeep = sourceEconomyStats.haulerUpkeep * haulerRatio
      sourceIncome =
        sourceEconomyStats.harvestIncome * productionRatio -
        sourceEconomyStats.minerUpkeep -
        actualHaulerUpkeep -
        sourceEconomyStats.infrastructureUpkeep
      sourceMaxIncome =
        sourceEconomyStats.harvestIncome -
        sourceEconomyStats.minerUpkeep -
        sourceEconomyStats.haulerUpkeep -
        sourceEconomyStats.infrastructureUpkeep
      sourceSpawnUsage = sourceEconomyStats.minerSpawnUsage + sourceEconomyStats.haulerSpawnUsage * haulerRatio

      income += sourceIncome
      maxIncome += sourceMaxIncome
      spawnUsage += sourceSpawnUsage
    }

    visualSourceRows.push({
      roomName: source.roomName,
      sourceIndex: sourceIndexById.get(source.id) ?? 0,
      distance: source.path.length,
      minerRatio,
      haulerRatio,
      grossIncome: sourceEconomyStats.harvestIncome,
      minerUpkeep: haulerRatio > 0 ? sourceEconomyStats.minerUpkeep : undefined,
      haulerUpkeep: actualHaulerUpkeep,
      infrastructureUpkeep: haulerRatio > 0 ? sourceEconomyStats.infrastructureUpkeep : undefined,
      income: sourceIncome,
      maxIncome: sourceMaxIncome,
      spawnUsage: sourceSpawnUsage,
    })

    if (!spawnRequested) {
      const priorityType = source.roomName === colonyName ? "ownedSource" : "remoteSource"

      if (minerRatio < 1 && minerRatio <= haulerNeedRatio && source.numMiners < source.miningPositions.length) {
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
      } else if (getRemoteMaintenanceSourceId(room) === source.id && remoteRepairers.length === 0) {
        requestRemoteRepairer(source)
      } else if (haulerNeedRatio < 1) {
        requestSpawn(
          {
            requesterId,
            spawnRoomName: colonyName,
            assignment,
            priorityType,
            order: source.path.length,
            rolesByPriority: ROLES_BY_PRIORITY,
          },
          () => createHaulerBody(room, haulerProfile),
          HAULER_ROLE,
          { memory: { haulerState: "idle", haulerProfile } },
        )

        spawnRequested = true
      } else if (source.remoteBuilderWorkNeeded !== undefined) {
        requestSpawn(
          {
            requesterId,
            spawnRoomName: colonyName,
            assignment,
            priorityType,
            order: source.path.length,
            rolesByPriority: ROLES_BY_PRIORITY,
          },
          () => createRemoteBuilderBody(room, source.remoteBuilderWorkNeeded!),
          REMOTE_BUILDER_ROLE,
          { memory: { sourceId: source.id } },
        )

        spawnRequested = true
      }
    }

    return {
      minerRatio,
      haulerRatio,
      ready,
    }
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

        const firstSourceResult = processSource(firstSource)

        if (firstSourceResult.ready) {
          requestReserver(roomState)
        }

        applyReservationUpkeep(roomState, firstSourceResult.ready)

        for (let i = 1; i < roomState.sources.length; i++) {
          processSource(roomState.sources[i])
        }
        break
      }

      case "ours": {
        requestReserver(roomState)

        applyReservationUpkeep(roomState)

        for (const source of roomState.sources) {
          const remoteConstruction = remoteConstructionBySource.get(source.id)

          if (remoteConstruction?.active) {
            source.remoteConstructionTarget = remoteConstruction.target

            const builders = remoteBuildersBySource.get(source.id) ?? []
            let currentWork = getRemoteBuilderWork(builders)

            while (currentWork < REMOTE_BUILDER_TARGET_WORK && unassignedRemoteBuilders.length > 0) {
              const builder = unassignedRemoteBuilders.pop()

              if (builder === undefined) {
                break
              }

              builder.memory.sourceId = source.id
              builders.push(builder)
              currentWork += getRemoteBuilderWork([builder])
            }

            if (builders.length > 0) {
              remoteBuildersBySource.set(source.id, builders)
            }

            const missingWork = REMOTE_BUILDER_TARGET_WORK - currentWork

            if (missingWork > 0) {
              source.remoteBuilderWorkNeeded = missingWork
            }

            if (remoteConstruction.target !== undefined) {
              const carryCapacity = getRemoteBuilderCarryCapacity(builders)

              if (carryCapacity > 0 && remoteConstruction.targetIndex !== undefined) {
                source.remoteBuilderCarryCapacity = carryCapacity
                source.builderCarryEquivalent = getRemoteBuilderCarryEquivalent(
                  builders,
                  source,
                  remoteConstruction.targetIndex,
                )
              }
            }
          }

          const sourceResult = processSource(source, true)
          const sourceMemory = getHarvestSourceMemory(room, source.id)

          if (sourceResult.ready) {
            sourceMemory.lastReadyTick = Game.time
          }

          if (sourceResult.ready && !sourceMemory.useRoad) {
            remoteConstructionCandidates.push(source)
          }
        }
        break
      }

      case "foreign":
        requestReserver(roomState)

        applyReservationUpkeep(roomState)
        break
    }
  }

  if (!spawnRequested && remoteRepairers.length === 0) {
    const maintenanceSourceId = getRemoteMaintenanceSourceId(room)
    const maintenanceSource = maintenanceSourceId === undefined ? undefined : sourceById.get(maintenanceSourceId)

    if (maintenanceSource !== undefined) {
      requestRemoteRepairer(maintenanceSource)
    }
  }

  if (!room.memory.use21Hauler && hasHaulerProfileScore && haulerScore21 < haulerScore11) {
    room.memory.use21Hauler = true
  }

  if (areRemoteRoadsEnabled(room)) {
    const availableSlots = Math.max(0, REMOTE_CONSTRUCTION_BATCH_SIZE - activeRemoteConstructionCount)
    for (let i = 0; i < Math.min(availableSlots, remoteConstructionCandidates.length); i++) {
      const source = remoteConstructionCandidates[i]

      activateRemoteConstructionSource(room, source.id, source.path)
    }
  }

  for (const reserver of reservers) {
    const remoteRoomName = reserver.memory.remoteRoomName

    if (remoteRoomName !== undefined && roomByName.has(remoteRoomName)) {
      runReserver(reserver, remoteRoomName)
    }
  }

  const storagePos = new RoomPosition(basePlan.storage.x, basePlan.storage.y, colonyName)

  runMiners(miners, sourceById, speedrunState?.travelingMiners)

  runRemoteBuilders(remoteBuilders, sourceById)

  runRemoteRepairers(room, remoteRepairers, sourceStates, sourceById)

  runHaulersPhase1(
    colonyName,
    storagePos,
    haulers,
    sourceStates,
    sourceById,
    logistics,
    speedrunState?.sourceHaulerCounts,
  )

  for (let i = 0; i < visualSourceRows.length; i++) {
    const source = sourceStates[i]

    if (source !== undefined) {
      visualSourceRows[i].containerEnergy = source.containerEnergy
      visualSourceRows[i].droppedEnergy = source.droppedEnergy
    }
  }

  const result: HarvestResult = {
    income,
    maxIncome,
    spawnUsage,
    activeSourcePaths,
    haulerPhase2: {
      haulers,
      sourceStates,
      sourceById,
      speedrun: speedrunState,
    },
  }

  if (options.visuals.harvest) {
    visualizeHarvest(room, visualSourceRows, visualReservationRows, result)
  }

  if (options.visuals.harvestPath) {
    visualizeHarvestPaths(sourceStates)
  }

  return result
}

function getRemoteBuilderWork(builders: readonly Creep[]): number {
  let result = 0

  for (const builder of builders) {
    for (const part of builder.body) {
      if (part.type === WORK) {
        result++
      }
    }
  }

  return result
}

function getReservationState(intel: RoomIntel, username: string): ReservationState {
  if (intel.controller?.owner?.username === username) {
    return "owned"
  }

  const reservation = intel.controller?.reservation

  if (reservation === undefined || reservation.endTick <= Game.time) {
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

function isReservationLifecycleActive(roomState: HarvestRoomState, firstSourceReady = false): boolean {
  if (roomState.reservationState === "ours" || roomState.hasReserver) {
    return true
  }

  if (roomState.reserverLeadTime === undefined) {
    return false
  }

  return roomState.reservationState === "foreign" || (roomState.reservationState === "none" && firstSourceReady)
}

function getReservationUpkeep(roomState: HarvestRoomState): { energy: number; spawnUsage: number } {
  const travelTicks = roomState.controllerTravelTicks

  if (travelTicks === undefined) {
    return { energy: 0, spawnUsage: 0 }
  }

  const productiveLifetime = CREEP_CLAIM_LIFE_TIME - travelTicks

  if (productiveLifetime <= 0) {
    return { energy: 0, spawnUsage: 0 }
  }

  return {
    energy: 650 / productiveLifetime,
    spawnUsage: (TARGET_RESERVE_POWER * CREEP_SPAWN_TIME) / productiveLifetime,
  }
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
  speedrun: boolean,
): HarvestRoomState[] {
  const colonyName = room.name
  const username = room.controller?.owner?.username

  if (username === undefined) {
    return []
  }

  const result: HarvestRoomState[] = []
  const runtime = getHarvestRuntime(colonyName)

  runtime.miningPositionsBySource ??= new Map()

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

      const haulerTravel = getHaulerTravelRuntime(basePlan, sourceIntel.id, sourcePlan.path, speedrun)

      const cachedMiningPositions = runtime.miningPositionsBySource.get(sourceIntel.id)
      const miningPositions =
        cachedMiningPositions?.path === sourcePlan.path
          ? cachedMiningPositions.positions
          : getMiningPositions(roomName, sourceIntel.coordinate, sourcePlan.path)

      if (cachedMiningPositions?.path !== sourcePlan.path) {
        runtime.miningPositionsBySource.set(sourceIntel.id, {
          path: sourcePlan.path,
          positions: miningPositions,
        })
      }

      const container = getSourceContainer(sourcePlan.path)
      const sourceObject = Game.getObjectById(sourceIntel.id)

      let droppedEnergy = 0
      let largestDroppedEnergy: Resource<ResourceConstant> | undefined

      if (sourceObject !== null) {
        for (const resource of sourceObject.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
          if (resource.resourceType !== RESOURCE_ENERGY) {
            continue
          }

          droppedEnergy += resource.amount

          if (largestDroppedEnergy === undefined || resource.amount > largestDroppedEnergy.amount) {
            largestDroppedEnergy = resource
          }
        }
      }

      const useRoadPath =
        !speedrun &&
        (roomName === colonyName
          ? (room.controller?.level ?? 0) >= 3
          : getHarvestSourceMemory(room, sourceIntel.id).roadsEstablished === true)
      const haulerCycleTravelTicks = useRoadPath
        ? haulerTravel.emptyTravelTicks + sourcePlan.path.length
        : haulerTravel.cycleTravelTicks

      sources.push({
        id: sourceIntel.id,
        roomName,
        path: sourcePlan.path,
        haulerTravel,
        useRoadPath,
        haulerCycleTravelTicks,

        miningPositions,
        requiredHarvestPower,
        requiredCarryCapacity: getRequiredCarryCapacity(
          requiredHarvestPower,
          haulerCycleTravelTicks,
          speedrun ? haulerTravel.emptyPath.length : undefined,
        ),
        sourceObject: sourceObject ?? undefined,
        container,
        containerEnergy: container?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
        droppedEnergy,
        largestDroppedEnergy,

        sustainableHarvestPower: 0,
        activeHarvestPower: 0,
        numMiners: 0,

        carryCapacity: 0,
        pendingEnergy: 0,
      })
    }

    sources.sort((left, right) => left.path.length - right.path.length || left.id.localeCompare(right.id))

    const reservationState = getReservationState(intel, username)
    let controllerTravelTicks: number | undefined
    let reserverLeadTime: number | undefined

    if (roomName !== colonyName) {
      const controllerRuntime = getRemoteControllerRuntime(basePlan, roomName, intel, sources)

      controllerTravelTicks = controllerRuntime?.travelTicks

      if (controllerRuntime !== undefined && reserverBody !== undefined) {
        reserverLeadTime =
          reserverBody.length * CREEP_SPAWN_TIME + controllerRuntime.travelTicks + RESERVER_REPLACEMENT_BUFFER
      }
    }

    result.push({
      roomName,
      intel,
      sources,
      reservationState,
      controllerTravelTicks,
      reserverLeadTime,
      reservePower: 0,
      hasReserver: false,
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

        return getDefaultRoomCostMatrix(currentRoomName)?.clone() ?? new PathFinder.CostMatrix()
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

  if (controller.reservation !== undefined && controller.reservation.endTick > Game.time) {
    return controller.reservation.username === username ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME : 0
  }

  return SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME
}
