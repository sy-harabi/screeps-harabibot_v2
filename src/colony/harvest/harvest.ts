import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { createSourceData, type SourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"

export interface SourceState {
  readonly data: SourceData

  harvestPower: number
  harvestingPower: number
  requiredHarvestPower: number

  numMiners: number

  requiredCarryCapacity: number
  carryCapacity: number
  pendingEnergy: number
}

const ROLES_BY_PRIORITY = [MINER_ROLE, HAULER_ROLE]

export function runHarvest(colonyName: string, room: Room, basePlan: BasePlan, context: TickContext): void {
  const sourceDataById = ensureSourceDataById(colonyName, room, basePlan)

  if (sourceDataById === undefined) {
    return
  }

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

    const sourceState = ensureSourceState(sourceDataById, sourceStateById, sourceId)

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

  for (const sourceId of sourceOrder) {
    const sourceState = ensureSourceState(sourceDataById, sourceStateById, sourceId)

    if (sourceState === undefined) {
      continue
    }

    sourceState.carryCapacity = Math.min(sourceState.requiredCarryCapacity, carryCapacityLeft)
    carryCapacityLeft -= sourceState.carryCapacity

    const minerRatio = sourceState.harvestPower / sourceState.requiredHarvestPower
    const haulerRatio = sourceState.carryCapacity / sourceState.requiredCarryCapacity

    if (
      minerRatio < 1 &&
      minerRatio <= haulerRatio &&
      sourceState.numMiners < sourceState.data.miningPositions.length
    ) {
      const targetWork = Math.ceil(sourceState.requiredHarvestPower / HARVEST_POWER)

      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType: "ownedSource",
          order: sourceState.data.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createMinerBody(colonyName, sourceState.data.path, targetWork, hasHarvestIncome),
        MINER_ROLE,
        { memory: { sourceId } },
      )
    } else if (haulerRatio < 1) {
      requestSpawn(
        {
          requesterId,
          spawnRoomName: colonyName,
          assignment,
          priorityType: "ownedSource",
          order: sourceState.data.path.length,
          rolesByPriority: ROLES_BY_PRIORITY,
        },
        () => createHaulerBody(colonyName),
        HAULER_ROLE,
      )
    }
  }

  runMiners(miners, sourceStateById)
  runHaulers(haulers, sourceOrder, sourceStateById)
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

  const travelTicks = estimatePathTravelTicks(path, workCount, moveCount)

  return miner.body.length * CREEP_SPAWN_TIME + travelTicks + 10
}

function ensureSourceState(
  sourceDataById: Map<Id<Source>, SourceData>,
  sourceStateById: Map<Id<Source>, SourceState>,
  sourceId: Id<Source>,
): SourceState | undefined {
  const sourceData = sourceDataById.get(sourceId)

  if (!sourceData) {
    return
  }

  let sourceState = sourceStateById.get(sourceId)
  const requiredHarvestPower = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME

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

function ensureSourceDataById(
  colonyName: string,
  room: Room,
  basePlan: BasePlan,
): Map<Id<Source>, SourceData> | undefined {
  const runtime = getHarvestRuntime(colonyName)

  if (runtime.sourceDataById !== undefined) {
    return runtime.sourceDataById
  }

  const sourceDataById = new Map<Id<Source>, SourceData>()
  let sourceReady = true

  for (const source of room.find(FIND_SOURCES)) {
    const sourceData = ensureOwnedSourceData(source, basePlan)

    if (sourceData === undefined) {
      sourceReady = false
      continue
    }

    sourceDataById.set(source.id, sourceData)
  }

  if (!sourceReady) {
    return
  }

  runtime.sourceDataById = sourceDataById
  return sourceDataById
}

function getSourceOrder(colonyName: string, sourceDataById: Map<Id<Source>, SourceData>): Id<Source>[] {
  const runtime = getHarvestRuntime(colonyName)

  if (runtime.sourceOrder !== undefined) {
    return runtime.sourceOrder
  }

  const sourceOrder = [...sourceDataById.values()]
    .sort((left, right) => left.path.length - right.path.length)
    .map((sourceData) => sourceData.sourceId)

  runtime.sourceOrder = sourceOrder

  return sourceOrder
}

function ensureOwnedSourceData(source: Source, basePlan: BasePlan): SourceData | undefined {
  const result = sourceDataStore.get(source.id)

  if (result.status === "ready") {
    return result.value
  }

  if (result.status === "loading") {
    return
  }

  const container = basePlan.structures.find(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.tag?.kind === "source" &&
      structure.tag?.id === source.id,
  )

  if (!container) {
    return
  }

  const path = findSourcePath(basePlan, container.coordinate)

  if (!path) {
    return
  }

  const sourceData = createSourceData(
    source.id,
    source.room.name,
    {
      x: source.pos.x,
      y: source.pos.y,
    },
    basePlan.roomName,
    path,
  )

  sourceDataStore.set(sourceData)

  return sourceData
}

function findSourcePath(basePlan: BasePlan, target: RoomCoordinate): RoomPosition[] | undefined {
  const result = PathFinder.search(
    new RoomPosition(basePlan.anchor.x, basePlan.anchor.y, basePlan.roomName),
    {
      pos: new RoomPosition(target.x, target.y, basePlan.roomName),
      range: 0,
    },
    {
      plainCost: 255,
      swampCost: 255,
      maxRooms: 1,
      roomCallback: () => {
        const costs = new PathFinder.CostMatrix()

        for (const structure of basePlan.structures) {
          if (structure.structureType === STRUCTURE_ROAD) {
            costs.set(structure.coordinate.x, structure.coordinate.y, 1)
          }
        }

        costs.set(target.x, target.y, 1)

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}
