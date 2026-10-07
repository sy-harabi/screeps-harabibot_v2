import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { getBotOptions } from "../../options/botOptions"
import { intelStore } from "../../world/intel/intelStore"
import type { LogisticsState } from "../logistics/logistics"
import { getHarvestSourceMemory } from "./harvestMemory"
import { prepareHarvestRoomStates } from "./harvestPreparation"
import {
  getRemoteMaintenanceSourceId,
  inspectRemoteMaintenanceSource,
  reconcileRemoteMaintenance,
} from "./remoteMaintenance"
import { planHarvest } from "./harvestRoomPlanner"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { createHaulerBody, createHaulTickState, HAULER_ROLE, prepareHauling } from "./hauler"
import type {
  HarvestResult,
  HarvestRoomState,
  HarvestSourceState,
  HaulerProfile,
  HaulerSpeedrunState,
} from "./harvestState"
import { createMinerBody, getMinerReplacementLeadTime, MINER_ROLE, runMiners } from "./miner"
import { createReserverBody, RESERVER_ROLE, runReserver } from "./reserver"
import {
  getReservationUpkeep,
  isReservationLifecycleActive,
  needsReserver,
} from "./reservationPolicy"
import { getSourceEconomyStats } from "./sourceEconomyStats"
import { visualizeHarvest, type HarvestVisualReservationRow, type HarvestVisualSourceRow } from "./harvestVisual"
import { visualizeHarvestPaths } from "./harvestPathVisual"
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

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000
const REMOTE_CONSTRUCTION_BATCH_SIZE = 2

const ROLES_BY_PRIORITY = [MINER_ROLE, REMOTE_REPAIRER_ROLE, HAULER_ROLE, RESERVER_ROLE, REMOTE_BUILDER_ROLE] as const
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

  const requestSourceSpawn = (
    source: HarvestSourceState,
    minerRatio: number,
    haulerNeedRatio: number,
    targetMinerWork: number,
    container: StructureContainer | undefined,
  ): void => {
    if (spawnRequested) {
      return
    }

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
      return
    }

    if (getRemoteMaintenanceSourceId(room) === source.id && remoteRepairers.length === 0) {
      requestRemoteRepairer(source)
      return
    }

    if (haulerNeedRatio < 1) {
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
        { memory: { haulerProfile } },
      )

      spawnRequested = true
      return
    }

    if (source.remoteBuilderWorkNeeded !== undefined) {
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

  const processSource = (source: HarvestSourceState, allowMaintenanceStart = false): boolean => {
    if (source.requiredHarvestPower <= 0) {
      return false
    }

    if (source.roomName === colonyName || source.sustainableHarvestPower > 0) {
      activeSourcePaths.push(source.path)
    }

    const requiredHaulerCapacity = Math.max(0, source.requiredCarryCapacity - (source.builderCarryEquivalent ?? 0))

    const allocatedHaulerCapacity = Math.min(requiredHaulerCapacity, carryCapacityLeft)

    carryCapacityLeft -= allocatedHaulerCapacity

    const minerRatio = source.sustainableHarvestPower / source.requiredHarvestPower

    const haulerNeedRatio = requiredHaulerCapacity <= 0 ? 1 : allocatedHaulerCapacity / requiredHaulerCapacity

    const colonyTransportRatio =
      source.requiredCarryCapacity <= 0 ? 1 : allocatedHaulerCapacity / source.requiredCarryCapacity

    const ready = colonyTransportRatio >= 1

    if (allowMaintenanceStart && ready) {
      inspectRemoteMaintenanceSource(room, source)
    }

    if (!options.speedrun && !room.memory.use21Hauler && requiredHaulerCapacity > 0 && haulerNeedRatio > 0) {
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

    if (colonyTransportRatio > 0) {
      const productionRatio = Math.min(1, minerRatio, colonyTransportRatio)

      actualHaulerUpkeep = sourceEconomyStats.haulerUpkeep * colonyTransportRatio
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
      sourceSpawnUsage = sourceEconomyStats.minerSpawnUsage + sourceEconomyStats.haulerSpawnUsage * colonyTransportRatio

      income += sourceIncome
      maxIncome += sourceMaxIncome
      spawnUsage += sourceSpawnUsage
    }

    visualSourceRows.push({
      roomName: source.roomName,
      sourceIndex: sourceIndexById.get(source.id) ?? 0,
      distance: source.path.length,
      minerRatio,
      colonyTransportRatio,
      grossIncome: sourceEconomyStats.harvestIncome,
      minerUpkeep: colonyTransportRatio > 0 ? sourceEconomyStats.minerUpkeep : undefined,
      haulerUpkeep: actualHaulerUpkeep,
      infrastructureUpkeep: colonyTransportRatio > 0 ? sourceEconomyStats.infrastructureUpkeep : undefined,
      income: sourceIncome,
      maxIncome: sourceMaxIncome,
      spawnUsage: sourceSpawnUsage,
    })

    requestSourceSpawn(source, minerRatio, haulerNeedRatio, targetMinerWork, container)

    return ready
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

        applyReservationUpkeep(roomState, firstSourceReady)

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

          const sourceReady = processSource(source, true)
          const sourceMemory = getHarvestSourceMemory(room, source.id)

          if (sourceReady) {
            sourceMemory.lastReadyTick = Game.time
          }

          if (sourceReady && !sourceMemory.useRoad) {
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

  const haulTickState = createHaulTickState(sourceStates, haulers)

  prepareHauling(colonyName, storagePos, haulers, sourceStates, sourceById, logistics, haulTickState, options.speedrun)

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
    hauling: {
      haulers,
      sourceStates,
      sourceById,
      haulTickState,
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

function getTargetMinerWork(room: Room, source: HarvestSourceState): number {
  if (source.roomName === room.name || room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]) {
    return Math.ceil(SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
  }

  return Math.ceil(SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME / HARVEST_POWER)
}
