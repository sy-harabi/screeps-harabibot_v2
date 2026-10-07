import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { createHaulerBody, HAULER_ROLE } from "./hauler"
import { getHarvestSourceMemory } from "./harvestMemory"
import type { HarvestRoomState, HarvestSourceState, HaulerProfile } from "./harvestState"
import { createMinerBody, MINER_ROLE } from "./miner"
import { RESERVER_ROLE } from "./reserver"
import { getReservationUpkeep, isReservationLifecycleActive, needsReserver } from "./reservationPolicy"
import { getSourceEconomyStats } from "./sourceEconomyStats"
import type { HarvestVisualReservationRow, HarvestVisualSourceRow } from "./harvestVisual"
import {
  createRemoteBuilderBody,
  getRemoteBuilderCarryCapacity,
  getRemoteBuilderCarryEquivalent,
  REMOTE_BUILDER_ROLE,
  REMOTE_BUILDER_TARGET_WORK,
} from "./remoteBuilder"
import {
  activateRemoteConstructionSource,
  areRemoteRoadsEnabled,
  type RemoteConstructionSourceState,
} from "./remoteConstruction"
import { getRemoteMaintenanceSourceId, inspectRemoteMaintenanceSource } from "./remoteMaintenance"
import { createRemoteRepairerBody, REMOTE_REPAIRER_ROLE } from "./remoteRepairer"

const SOURCE_CONTAINER_REPAIR_THRESHOLD = 150_000
const REMOTE_CONSTRUCTION_BATCH_SIZE = 2

const ROLES_BY_PRIORITY = [MINER_ROLE, REMOTE_REPAIRER_ROLE, HAULER_ROLE, RESERVER_ROLE, REMOTE_BUILDER_ROLE] as const

export interface HarvestSchedulerInput {
  readonly room: Room
  readonly roomStates: readonly HarvestRoomState[]
  readonly sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>
  readonly sourceIndexById: ReadonlyMap<Id<Source>, number>

  readonly reserverBody?: readonly BodyPartConstant[]
  readonly remoteRepairers: readonly Creep[]

  readonly remoteConstructionBySource: ReadonlyMap<Id<Source>, RemoteConstructionSourceState>
  readonly remoteBuildersBySource: Map<Id<Source>, Creep[]>
  readonly unassignedRemoteBuilders: Creep[]

  readonly totalCarryCapacity: number
  readonly hasHarvestIncome: boolean
  readonly haulerProfile: HaulerProfile
  readonly speedrun: boolean
  readonly activeRemoteConstructionCount: number
}

export interface HarvestSchedulerResult {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
  readonly activeSourcePaths: readonly (readonly RoomPosition[])[]
  readonly sourceRows: HarvestVisualSourceRow[]
  readonly reservationRows: HarvestVisualReservationRow[]
}

interface HarvestSchedulerContext extends HarvestSchedulerInput {
  readonly colonyName: string
  readonly requesterId: string
  readonly assignment: {
    readonly type: "colony"
    readonly colonyName: string
  }
}

interface HarvestSchedulerState {
  carryCapacityLeft: number
  spawnRequested: boolean

  income: number
  maxIncome: number
  spawnUsage: number

  haulerScore11: number
  haulerScore21: number
  hasHaulerProfileScore: boolean

  readonly activeSourcePaths: (readonly RoomPosition[])[]
  readonly sourceRows: HarvestVisualSourceRow[]
  readonly reservationRows: HarvestVisualReservationRow[]
  readonly remoteConstructionCandidates: HarvestSourceState[]
}

export function runHarvestScheduler(input: HarvestSchedulerInput): HarvestSchedulerResult {
  const colonyName = input.room.name
  const context: HarvestSchedulerContext = {
    ...input,
    colonyName,
    requesterId: "harvest:" + colonyName,
    assignment: {
      type: "colony",
      colonyName,
    },
  }
  const state = createSchedulerState(input.totalCarryCapacity)

  for (const roomState of input.roomStates) {
    processRoom(context, state, roomState)
  }

  finishMaintenanceSpawn(context, state)
  updateHaulerProfile(context, state)
  activateRemoteConstruction(context, state)

  return {
    income: state.income,
    maxIncome: state.maxIncome,
    spawnUsage: state.spawnUsage,
    activeSourcePaths: state.activeSourcePaths,
    sourceRows: state.sourceRows,
    reservationRows: state.reservationRows,
  }
}

function createSchedulerState(totalCarryCapacity: number): HarvestSchedulerState {
  return {
    carryCapacityLeft: totalCarryCapacity,
    spawnRequested: false,

    income: 0,
    maxIncome: 0,
    spawnUsage: 0,

    haulerScore11: 0,
    haulerScore21: 0,
    hasHaulerProfileScore: false,

    activeSourcePaths: [],
    sourceRows: [],
    reservationRows: [],
    remoteConstructionCandidates: [],
  }
}

function processRoom(
  context: HarvestSchedulerContext,
  state: HarvestSchedulerState,
  roomState: HarvestRoomState,
): void {
  switch (roomState.reservationState) {
    case "owned":
      for (const source of roomState.sources) {
        processSource(context, state, source)
      }
      return

    case "none": {
      const firstSource = roomState.sources[0]

      if (firstSource === undefined) {
        return
      }

      const firstSourceReady = processSource(context, state, firstSource)

      if (firstSourceReady) {
        requestReserver(context, state, roomState)
      }

      applyReservationUpkeep(state, roomState, firstSourceReady)

      for (let i = 1; i < roomState.sources.length; i++) {
        processSource(context, state, roomState.sources[i])
      }
      return
    }

    case "ours":
      requestReserver(context, state, roomState)
      applyReservationUpkeep(state, roomState)

      for (const source of roomState.sources) {
        prepareRemoteConstructionSource(context, source)

        const sourceReady = processSource(context, state, source, true)
        const sourceMemory = getHarvestSourceMemory(context.room, source.id)

        if (sourceReady) {
          sourceMemory.lastReadyTick = Game.time
        }

        if (sourceReady && !sourceMemory.useRoad) {
          state.remoteConstructionCandidates.push(source)
        }
      }
      return

    case "foreign":
      requestReserver(context, state, roomState)
      applyReservationUpkeep(state, roomState)
  }
}

function prepareRemoteConstructionSource(context: HarvestSchedulerContext, source: HarvestSourceState): void {
  const remoteConstruction = context.remoteConstructionBySource.get(source.id)

  if (!remoteConstruction?.active) {
    return
  }

  source.remoteConstructionTarget = remoteConstruction.target

  const builders = context.remoteBuildersBySource.get(source.id) ?? []
  let currentWork = getRemoteBuilderWork(builders)

  while (currentWork < REMOTE_BUILDER_TARGET_WORK && context.unassignedRemoteBuilders.length > 0) {
    const builder = context.unassignedRemoteBuilders.pop()

    if (builder === undefined) {
      break
    }

    builder.memory.sourceId = source.id
    builders.push(builder)
    currentWork += getRemoteBuilderWork([builder])
  }

  if (builders.length > 0) {
    context.remoteBuildersBySource.set(source.id, builders)
  }

  const missingWork = REMOTE_BUILDER_TARGET_WORK - currentWork

  if (missingWork > 0) {
    source.remoteBuilderWorkNeeded = missingWork
  }

  if (remoteConstruction.target === undefined) {
    return
  }

  const carryCapacity = getRemoteBuilderCarryCapacity(builders)

  if (carryCapacity > 0 && remoteConstruction.targetIndex !== undefined) {
    source.remoteBuilderCarryCapacity = carryCapacity
    source.builderCarryEquivalent = getRemoteBuilderCarryEquivalent(builders, source, remoteConstruction.targetIndex)
  }
}

function processSource(
  context: HarvestSchedulerContext,
  state: HarvestSchedulerState,
  source: HarvestSourceState,
  allowMaintenanceStart = false,
): boolean {
  if (source.requiredHarvestPower <= 0) {
    return false
  }

  if (source.roomName === context.colonyName || source.sustainableHarvestPower > 0) {
    state.activeSourcePaths.push(source.path)
  }

  const requiredHaulerCapacity = Math.max(0, source.requiredCarryCapacity - (source.builderCarryEquivalent ?? 0))
  const allocatedHaulerCapacity = Math.min(requiredHaulerCapacity, state.carryCapacityLeft)

  state.carryCapacityLeft -= allocatedHaulerCapacity

  const minerRatio = source.sustainableHarvestPower / source.requiredHarvestPower
  const haulerNeedRatio = requiredHaulerCapacity <= 0 ? 1 : allocatedHaulerCapacity / requiredHaulerCapacity
  const colonyTransportRatio =
    source.requiredCarryCapacity <= 0 ? 1 : allocatedHaulerCapacity / source.requiredCarryCapacity
  const ready = colonyTransportRatio >= 1

  if (allowMaintenanceStart && ready) {
    inspectRemoteMaintenanceSource(context.room, source)
  }

  if (
    !context.speedrun &&
    !context.room.memory.use21Hauler &&
    requiredHaulerCapacity > 0 &&
    haulerNeedRatio > 0
  ) {
    const cycle11 = source.haulerCycleTravelTicks
    const cycle21 = source.useRoadPath ? source.haulerCycleTravelTicks : source.haulerTravel.cycleTravelTicks21

    state.haulerScore11 += source.requiredHarvestPower * cycle11 * 2
    state.haulerScore21 += source.requiredHarvestPower * cycle21 * 1.5
    state.hasHaulerProfileScore = true
  }

  const targetMinerWork = getTargetMinerWork(context.room, source)
  const container = source.container
  const sourceEconomyStats = getSourceEconomyStats(
    context.room,
    source.id,
    source.path,
    source.miningPositions.length,
    source.requiredHarvestPower,
    targetMinerWork,
    container !== undefined,
    source.haulerCycleTravelTicks,
    context.haulerProfile,
    context.speedrun ? source.haulerTravel.emptyPath.length : undefined,
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

    state.income += sourceIncome
    state.maxIncome += sourceMaxIncome
    state.spawnUsage += sourceSpawnUsage
  }

  state.sourceRows.push({
    roomName: source.roomName,
    sourceIndex: context.sourceIndexById.get(source.id) ?? 0,
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

  requestSourceSpawn(context, state, source, minerRatio, haulerNeedRatio, targetMinerWork, container)

  return ready
}

function requestSourceSpawn(
  context: HarvestSchedulerContext,
  state: HarvestSchedulerState,
  source: HarvestSourceState,
  minerRatio: number,
  haulerNeedRatio: number,
  targetMinerWork: number,
  container: StructureContainer | undefined,
): void {
  if (state.spawnRequested) {
    return
  }

  const priorityType = source.roomName === context.colonyName ? "ownedSource" : "remoteSource"

  if (minerRatio < 1 && minerRatio <= haulerNeedRatio && source.numMiners < source.miningPositions.length) {
    const repairContainer =
      context.hasHarvestIncome && container !== undefined && container.hits < SOURCE_CONTAINER_REPAIR_THRESHOLD
    const targetWork = targetMinerWork + (repairContainer ? 1 : 0)

    requestSpawn(
      {
        requesterId: context.requesterId,
        spawnRoomName: context.colonyName,
        assignment: context.assignment,
        priorityType,
        order: source.path.length,
        rolesByPriority: ROLES_BY_PRIORITY,
      },
      () => createMinerBody(context.room, source.path, targetWork, context.hasHarvestIncome, { carry: repairContainer }),
      MINER_ROLE,
      { memory: { sourceId: source.id } },
    )

    state.spawnRequested = true
    return
  }

  if (getRemoteMaintenanceSourceId(context.room) === source.id && context.remoteRepairers.length === 0) {
    requestRemoteRepairer(context, state, source)
    return
  }

  if (haulerNeedRatio < 1) {
    requestSpawn(
      {
        requesterId: context.requesterId,
        spawnRoomName: context.colonyName,
        assignment: context.assignment,
        priorityType,
        order: source.path.length,
        rolesByPriority: ROLES_BY_PRIORITY,
      },
      () => createHaulerBody(context.room, context.haulerProfile),
      HAULER_ROLE,
      { memory: { haulerProfile: context.haulerProfile } },
    )

    state.spawnRequested = true
    return
  }

  if (source.remoteBuilderWorkNeeded !== undefined) {
    requestSpawn(
      {
        requesterId: context.requesterId,
        spawnRoomName: context.colonyName,
        assignment: context.assignment,
        priorityType,
        order: source.path.length,
        rolesByPriority: ROLES_BY_PRIORITY,
      },
      () => createRemoteBuilderBody(context.room, source.remoteBuilderWorkNeeded!),
      REMOTE_BUILDER_ROLE,
      { memory: { sourceId: source.id } },
    )

    state.spawnRequested = true
  }
}

function requestReserver(
  context: HarvestSchedulerContext,
  state: HarvestSchedulerState,
  roomState: HarvestRoomState,
): void {
  if (state.spawnRequested || context.reserverBody === undefined || !needsReserver(roomState)) {
    return
  }

  const firstSource = roomState.sources[0]

  if (firstSource === undefined) {
    return
  }

  requestSpawn(
    {
      requesterId: context.requesterId,
      spawnRoomName: context.colonyName,
      assignment: context.assignment,
      priorityType: "remoteSource",
      order: firstSource.path.length,
      rolesByPriority: ROLES_BY_PRIORITY,
    },
    context.reserverBody,
    RESERVER_ROLE,
    {
      memory: {
        remoteRoomName: roomState.roomName,
      },
    },
  )

  state.spawnRequested = true
}

function requestRemoteRepairer(
  context: HarvestSchedulerContext,
  state: HarvestSchedulerState,
  source: HarvestSourceState,
): void {
  if (state.spawnRequested || context.remoteRepairers.length > 0) {
    return
  }

  requestSpawn(
    {
      requesterId: context.requesterId,
      spawnRoomName: context.colonyName,
      assignment: context.assignment,
      priorityType: "remoteSource",
      order: source.path.length,
      rolesByPriority: ROLES_BY_PRIORITY,
    },
    () => createRemoteRepairerBody(context.room),
    REMOTE_REPAIRER_ROLE,
  )

  state.spawnRequested = true
}

function applyReservationUpkeep(
  state: HarvestSchedulerState,
  roomState: HarvestRoomState,
  firstSourceReady = false,
): void {
  if (!isReservationLifecycleActive(roomState, firstSourceReady)) {
    return
  }

  const upkeep = getReservationUpkeep(roomState)

  state.income -= upkeep.energy
  state.maxIncome -= upkeep.energy
  state.spawnUsage += upkeep.spawnUsage

  state.reservationRows.push({
    roomName: roomState.roomName,
    upkeep: upkeep.energy,
    spawnUsage: upkeep.spawnUsage,
  })
}

function finishMaintenanceSpawn(context: HarvestSchedulerContext, state: HarvestSchedulerState): void {
  if (state.spawnRequested || context.remoteRepairers.length > 0) {
    return
  }

  const maintenanceSourceId = getRemoteMaintenanceSourceId(context.room)
  const maintenanceSource =
    maintenanceSourceId === undefined ? undefined : context.sourceById.get(maintenanceSourceId)

  if (maintenanceSource !== undefined) {
    requestRemoteRepairer(context, state, maintenanceSource)
  }
}

function updateHaulerProfile(context: HarvestSchedulerContext, state: HarvestSchedulerState): void {
  if (
    !context.room.memory.use21Hauler &&
    state.hasHaulerProfileScore &&
    state.haulerScore21 < state.haulerScore11
  ) {
    context.room.memory.use21Hauler = true
  }
}

function activateRemoteConstruction(context: HarvestSchedulerContext, state: HarvestSchedulerState): void {
  if (!areRemoteRoadsEnabled(context.room)) {
    return
  }

  const availableSlots = Math.max(0, REMOTE_CONSTRUCTION_BATCH_SIZE - context.activeRemoteConstructionCount)

  for (let i = 0; i < Math.min(availableSlots, state.remoteConstructionCandidates.length); i++) {
    const source = state.remoteConstructionCandidates[i]

    activateRemoteConstructionSource(context.room, source.id, source.path)
  }
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
