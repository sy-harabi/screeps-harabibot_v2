import type { BasePlan } from "../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../capabilities/basePlanning/basePlanStore"
import { planBase } from "../capabilities/basePlanning/planBase"
import type { TickContext } from "../kernel/tickContext"
import { runHarvest } from "./harvest/harvest"
import { createLogisticsState, runLogistics } from "./logistics/logistics"

export function runColonies(context: TickContext): void {
  for (const room of context.ownedRooms.values()) {
    runColony(room, context)
  }
}

function runColony(room: Room, context: TickContext): void {
  const basePlan = ensureBasePlan(room)

  if (!basePlan) {
    return
  }

  if (Memory.options?.visuals?.basePlan) {
    visualizeFinalPlan(basePlan, new RoomVisual(room.name))
  }

  const logistics = createLogisticsState()

  runHarvest(room.name, room, basePlan, context, logistics)

  runLogistics(room, logistics)
}

function ensureBasePlan(room: Room): BasePlan | undefined {
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
