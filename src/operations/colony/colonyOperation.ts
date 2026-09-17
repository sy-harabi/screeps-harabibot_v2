import { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import { planBase } from "../../capabilities/basePlanning/planBase"
import type { EmpireOperationRecord } from "../empire/empireOperation"
import { ensureOperation, OperationBase } from "../operation"
import type { OperationHandler } from "../operationHandler"

import { createOwnedSourceOperation } from "../ownedSource/ownedSourceOperation"

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
  plan(operation, context): void {
    const { roomName } = operation

    const terrain = Game.map.getRoomTerrain(roomName)

    const room = Game.rooms[roomName]

    if (!room || !room.controller || !room.controller.my) {
      return
    }

    const sources = room.find(FIND_SOURCES)

    const minerals = room.find(FIND_MINERALS)

    const existingSpawn = room.find(FIND_MY_SPAWNS)[0]

    const basePlanResult = basePlanStore.get(roomName)

    let basePlan: BasePlan | undefined

    if (basePlanResult.status === "loading") {
      return
    }

    if (basePlanResult.status === "ready") {
      basePlan = basePlanResult.value
    } else if (basePlanResult.status === "missing") {
      const plan = planBase(roomName, terrain, room.controller, sources, minerals, {
        existingSpawn: existingSpawn?.pos,
      })

      if (plan === undefined) {
        return
      }

      basePlanStore.set(roomName, plan)

      basePlan = plan
    }

    if (!basePlan) {
      return
    }

    if (Memory.options?.visuals?.basePlan) {
      visualizeFinalPlan(basePlan, new RoomVisual(roomName))
    }

    for (const source of sources) {
      ensureOperation(createOwnedSourceOperation(operation.id, roomName, source.id))
    }
  },

  execute(operation, context): void {},
}

function visualizeFinalPlan(basePlan: BasePlan, visual: RoomVisual): void {
  visual.clear()
  visual.roads = []

  for (const structure of basePlan.structures) {
    visual.structure(structure.coordinate.x, structure.coordinate.y, structure.structureType)
  }

  visual.connectRoads()
}
