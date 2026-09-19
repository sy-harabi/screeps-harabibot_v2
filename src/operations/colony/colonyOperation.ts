import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import { planBase } from "../../capabilities/basePlanning/planBase"
import type { EmpireOperationRecord } from "../empire/empireOperation"
import { createHarvestOperation } from "../harvest/harvestOperation"
import { ensureOperation, OperationBase } from "../operation"
import type { OperationHandler } from "../operationHandler"

export interface ColonyOperationRecord extends OperationBase {
  readonly id: string
  readonly type: "colony"
  readonly parentId: EmpireOperationRecord["id"]
  readonly roomName: string
}

export function getColonyOperationId(roomName: string): string {
  return `colony:${roomName}`
}

export function createColonyOperation(roomName: string): ColonyOperationRecord {
  return {
    id: getColonyOperationId(roomName),
    type: "colony",
    parentId: "empire",
    roomName,
    status: "active",
  }
}

export const colonyOperationHandler: OperationHandler<ColonyOperationRecord> = {
  plan(operation): void {
    const { roomName } = operation

    const room = Game.rooms[roomName]

    if (!room?.controller?.my) {
      return
    }

    const basePlan = ensureBasePlan(room)

    if (basePlan === undefined) {
      return
    }

    if (Memory.options?.visuals?.basePlan) {
      visualizeFinalPlan(basePlan, new RoomVisual(roomName))
    }

    ensureOperation(createHarvestOperation(operation.id, roomName))
  },

  execute(): void {},
}

function ensureBasePlan(room: Room) {
  const basePlanResult = basePlanStore.get(room.name)

  if (basePlanResult.status === "ready") {
    return basePlanResult.value
  }

  if (basePlanResult.status === "loading") {
    return
  }

  const sources = room.find(FIND_SOURCES)

  const terrain = Game.map.getRoomTerrain(room.name)

  const minerals = room.find(FIND_MINERALS)

  const existingSpawn = room.find(FIND_MY_SPAWNS)[0]

  const plan = planBase(room.name, terrain, room.controller!, sources, minerals, {
    existingSpawn: existingSpawn?.pos,
  })

  if (plan === undefined) {
    return
  }

  basePlanStore.set(room.name, plan)

  return plan
}

function visualizeFinalPlan(basePlan: BasePlan, visual: RoomVisual): void {
  visual.clear()
  visual.roads = []

  for (const structure of basePlan.structures) {
    visual.structure(structure.coordinate.x, structure.coordinate.y, structure.structureType)
  }

  visual.connectRoads()
}
