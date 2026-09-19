import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import type { TickContext } from "../../kernel/tickContext"
import { getOperationHeap } from "../../runtime/operationRuntime"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import type { ColonyOperationRecord } from "../colony/colonyOperation"
import type { OperationBase } from "../operation"
import type { OperationHandler } from "../operationHandler"
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

    for (const sourceId of sourceOrder) {
      const sourceData = sourceDataById.get(sourceId)
    }
  },

  execute(operation: HarvestOperationRecord, context: TickContext): void {},
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
