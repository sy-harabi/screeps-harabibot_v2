import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getOperationCreeps, type TickContext } from "../../kernel/tickContext"
import { getOperationHeap, getOperationTemp } from "../../runtime/operationRuntime"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import type { ColonyOperationRecord } from "../colony/colonyOperation"
import type { OperationBase } from "../operation"
import type { OperationHandler } from "../operationHandler"
import { createHaulerBody, HAULER_ROLE, runHaulers } from "./hauler"
import { createMinerBody, MINER_ROLE, runMiners } from "./miner"
import { SourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"

export interface HarvestOperationRecord extends OperationBase {
  readonly id: string
  readonly type: "harvest"
  readonly parentId: ColonyOperationRecord["id"]
  readonly roomName: string
}

interface HarvestOperationHeap {
  sourceDataById?: Map<Id<Source>, SourceData>
  sourceOrder?: Id<Source>[]
}

export interface HarvestOperationTemp {
  sourceOrder: readonly Id<Source>[]
  sourceStateById: Map<Id<Source>, SourceState>
}

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

export function getHarvestOperationId(roomName: string): string {
  return `harvest:${roomName}`
}

export function createHarvestOperation(
  parentId: ColonyOperationRecord["id"],
  roomName: string,
): HarvestOperationRecord {
  return {
    id: getHarvestOperationId(roomName),
    type: "harvest",
    parentId,
    roomName,
    status: "active",
  }
}

export const harvestOperationHandler: OperationHandler<HarvestOperationRecord> = {
  plan(operation: HarvestOperationRecord, context: TickContext): void {
    const room = context.ownedRooms.get(operation.roomName)

    if (!room) {
      return
    }

    const basePlanResult = basePlanStore.get(operation.roomName)

    if (basePlanResult.status !== "ready") {
      return
    }

    const basePlan = basePlanResult.value

    const sourceDataById = ensureSourceDataById(operation, room, basePlan)

    if (sourceDataById === undefined) {
      return
    }

    const sourceOrder = getSourceOrder(operation, sourceDataById)

    const temp = getOperationTemp<HarvestOperationTemp>(operation.id)
    temp.sourceOrder = sourceOrder
    temp.sourceStateById = new Map<Id<Source>, SourceState>()

    const sourceStateById = temp.sourceStateById

    for (const miner of getOperationCreeps(context, operation.id, MINER_ROLE)) {
      const sourceId = miner.memory.sourceId

      if (!sourceId) {
        continue
      }

      const sourceState = ensureSourceState(sourceDataById, sourceStateById, sourceId)

      if (sourceState === undefined) {
        continue
      }

      const replacementLeadTime = miner.body.length * CREEP_SPAWN_TIME + sourceState.data.path.length + 10

      if ((miner.ticksToLive ?? CREEP_LIFE_TIME) > replacementLeadTime) {
        sourceState.harvestPower += miner.getActiveBodyparts(WORK) * HARVEST_POWER
        sourceState.numMiners++
      }
    }

    let totalCarryCapacity = 0

    for (const hauler of getOperationCreeps(context, operation.id, HAULER_ROLE)) {
      const replacementLeadTime = hauler.body.length * CREEP_SPAWN_TIME + 10

      if ((hauler.ticksToLive ?? CREEP_LIFE_TIME) > replacementLeadTime) {
        totalCarryCapacity += hauler.getActiveBodyparts(CARRY) * CARRY_CAPACITY
      }
    }

    let carryCapacityLeft = totalCarryCapacity

    for (const sourceId of sourceOrder) {
      const sourceState = ensureSourceState(sourceDataById, sourceStateById, sourceId)

      if (sourceState === undefined) {
        continue
      }

      sourceState.carryCapacity = Math.min(sourceState.requiredCarryCapacity, carryCapacityLeft)

      carryCapacityLeft -= sourceState.carryCapacity

      const minerRatio = sourceState.harvestPower / sourceState.requiredHarvestPower

      const haulerRatio = sourceState.carryCapacity / sourceState.requiredCarryCapacity

      if (minerRatio < 1 && minerRatio <= haulerRatio) {
        requestSpawn(
          {
            requesterId: operation.id,
            roomName: operation.roomName,
            priorityType: "ownedSource",
            order: sourceState.data.path.length,
            rolesByPriority: ROLES_BY_PRIORITY,
          },
          () => createMinerBody(operation.roomName),
          MINER_ROLE,
          { memory: { sourceId } },
        )
      } else if (haulerRatio < 1) {
        requestSpawn(
          {
            requesterId: operation.id,
            roomName: operation.roomName,
            priorityType: "ownedSource",
            order: sourceState.data.path.length,
            rolesByPriority: ROLES_BY_PRIORITY,
          },
          () => createHaulerBody(operation.roomName),
          HAULER_ROLE,
        )
      }
    }
  },

  execute(operation: HarvestOperationRecord, context: TickContext): void {
    const { sourceOrder, sourceStateById } = getOperationTemp<HarvestOperationTemp>(operation.id)

    if (sourceOrder === undefined || sourceStateById === undefined) {
      console.log(`[HarvestOperation] Missing temp state: ${operation.id}`)
      return
    }

    runMiners(operation, context, sourceStateById)
    runHaulers(operation, context, sourceOrder, sourceStateById)
  },
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
      requiredHarvestPower: requiredHarvestPower,
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
  operation: HarvestOperationRecord,
  room: Room,
  basePlan: BasePlan,
): Map<Id<Source>, SourceData> | undefined {
  const heap = getOperationHeap<HarvestOperationHeap>(operation.id)

  if (heap.sourceDataById !== undefined) {
    return heap.sourceDataById
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

  heap.sourceDataById = sourceDataById
  return sourceDataById
}

function getSourceOrder(operation: HarvestOperationRecord, sourceDataById: Map<Id<Source>, SourceData>): Id<Source>[] {
  const heap = getOperationHeap<HarvestOperationHeap>(operation.id)

  if (heap.sourceOrder !== undefined) {
    return heap.sourceOrder
  }

  const sourceOrder = [...sourceDataById.values()]
    .sort((left, right) => left.path.length - right.path.length)
    .map((sourceData) => sourceData.sourceId)

  heap.sourceOrder = sourceOrder

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

  const sourceData: SourceData = {
    sourceId: source.id,
    roomName: source.room.name,
    coordinate: {
      x: source.pos.x,
      y: source.pos.y,
    },
    colonyRoomName: basePlan.roomName,
    path,
  }

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
