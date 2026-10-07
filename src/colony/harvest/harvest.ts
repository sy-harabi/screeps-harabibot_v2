import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { getBotOptions } from "../../options/botOptions"
import { intelStore } from "../../world/intel/intelStore"
import type { LogisticsState } from "../logistics/logistics"
import { prepareHarvestState } from "./harvestPreparation"
import { runHarvestScheduler } from "./harvestScheduler"
import { reconcileRemoteMaintenance } from "./remoteMaintenance"
import { planHarvest } from "./harvestRoomPlanner"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { createHaulTickState, HAULER_ROLE, prepareHauling } from "./hauler"
import type { HarvestResult, HaulerProfile, HaulerSpeedrunState } from "./harvestState"
import { getMinerReplacementLeadTime, MINER_ROLE, runMiners } from "./miner"
import { createReserverBody, RESERVER_ROLE, runReserver } from "./reserver"
import { visualizeHarvest } from "./harvestVisual"
import { visualizeHarvestPaths } from "./harvestPathVisual"
import { REMOTE_BUILDER_ROLE, runRemoteBuilders } from "./remoteBuilder"
import { runRemoteConstructionSource, type RemoteConstructionSourceState } from "./remoteConstruction"
import { REMOTE_REPAIRER_ROLE, runRemoteRepairers } from "./remoteRepairer"

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

  const { roomStates, roomByName, sourceStates, sourceById, sourceIndexById } = prepareHarvestState(
    room,
    basePlan,
    reserverBody,
    options.speedrun,
  )

  const remoteBuildersBySource = new Map<Id<Source>, Creep[]>()
  const unassignedRemoteBuilders: Creep[] = []
  const remoteConstructionBySource = new Map<Id<Source>, RemoteConstructionSourceState>()

  let activeRemoteConstructionCount = 0

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

  const schedule = runHarvestScheduler({
    room,
    roomStates,
    sourceById,
    sourceIndexById,
    reserverBody,
    remoteRepairers,
    remoteConstructionBySource,
    remoteBuildersBySource,
    unassignedRemoteBuilders,
    totalCarryCapacity,
    hasHarvestIncome,
    haulerProfile,
    speedrun: options.speedrun,
    activeRemoteConstructionCount,
  })

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

  for (let i = 0; i < schedule.sourceRows.length; i++) {
    const source = sourceStates[i]

    if (source !== undefined) {
      schedule.sourceRows[i].containerEnergy = source.containerEnergy
      schedule.sourceRows[i].droppedEnergy = source.droppedEnergy
    }
  }

  const result: HarvestResult = {
    income: schedule.income,
    maxIncome: schedule.maxIncome,
    spawnUsage: schedule.spawnUsage,
    activeSourcePaths: schedule.activeSourcePaths,
    hauling: {
      haulers,
      sourceStates,
      sourceById,
      haulTickState,
      speedrun: speedrunState,
    },
  }

  if (options.visuals.harvest) {
    visualizeHarvest(room, schedule.sourceRows, schedule.reservationRows, result)
  }

  if (options.visuals.harvestPath) {
    visualizeHarvestPaths(sourceStates)
  }

  return result
}
