import type { BasePlan } from "../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../capabilities/basePlanning/basePlanStore"
import { visualizeBasePlanStructures } from "../capabilities/basePlanning/basePlanVisual"
import { planBase } from "../capabilities/basePlanning/planBase"
import type { TickContext } from "../kernel/tickContext"
import { runBuild } from "./build/build"
import { runConstruction } from "./build/construction"
import { runHarvest } from "./harvest/harvest"
import { createLogisticsState, runLogistics } from "./logistics/logistics"
import { runTowers } from "./tower/tower"
import { runUpgrade } from "./upgrade/upgrade"

export function runColonies(context: TickContext): void {
  for (const room of context.ownedRooms.values()) {
    runColony(room, context)
  }
}

export interface ColonyEnergyState {
  readonly storage: number
  readonly terminal: number
  readonly total: number
}

export const ENERGY_RESERVE_BY_RCL: Partial<Record<number, number>> = {
  4: 20_000,
  5: 30_000,
  6: 60_000,
  7: 100_000,
  8: 200_000,
}

function runColony(room: Room, context: TickContext): void {
  const basePlan = ensureBasePlan(room)

  if (!basePlan) {
    return
  }

  if (Memory.options?.visuals?.basePlan) {
    visualizeBasePlanStructures(basePlan.structures, new RoomVisual(room.name))
  }

  const logistics = createLogisticsState()

  const energy = getColonyEnergyState(room)

  const harvest = runHarvest(room, basePlan, context, logistics)

  const construction = runConstruction(room, basePlan)

  runBuild(room, context, logistics, harvest.income, construction)

  runUpgrade(room, basePlan, context, logistics, harvest.income, construction, energy)

  runTowers(room, logistics)

  runLogistics(room, logistics)
}

function getColonyEnergyState(room: Room): ColonyEnergyState {
  const storage = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0

  const terminal = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0

  return {
    storage,
    terminal,
    total: storage + terminal,
  }
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
