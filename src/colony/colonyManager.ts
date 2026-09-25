import type { BasePlan } from "../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../capabilities/basePlanning/basePlanStore"
import { visualizeBasePlanStructures } from "../capabilities/basePlanning/basePlanVisual"
import { planBase } from "../capabilities/basePlanning/planBase"
import type { TickContext } from "../kernel/tickContext"
import { runBuild } from "./build/build"
import { runConstruction } from "./build/construction"
import { runHarvest } from "./harvest/harvest"
import { refreshRemoteSources } from "./harvest/remoteMining"
import { createLogisticsState, runLogistics } from "./logistics/logistics"
import { runTowers } from "./tower/tower"
import { runUpgrade } from "./upgrade/upgrade"

export function runColonies(context: TickContext, newlyObservedRooms: readonly string[]): void {
  for (const room of context.ownedRooms.values()) {
    runColony(room, context, newlyObservedRooms)
  }
}

function runColony(room: Room, context: TickContext, newlyObservedRooms: readonly string[]): void {
  const basePlan = ensureBasePlan(room)

  if (!basePlan) {
    return
  }

  if (Memory.options?.visuals?.basePlan) {
    visualizeBasePlanStructures(basePlan.structures, new RoomVisual(room.name))
  }

  const logistics = createLogisticsState()

  refreshRemoteSources(room, basePlan, newlyObservedRooms)

  const harvest = runHarvest(room, basePlan, context, logistics)

  const construction = runConstruction(room, basePlan)

  runBuild(room, context, logistics, harvest.income, construction)

  runUpgrade(room, basePlan, context, logistics, harvest.income, construction)

  runTowers(room, logistics)

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

  basePlanStore.set(plan)

  return plan
}
