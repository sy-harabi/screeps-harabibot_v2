import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody } from "./miner"
import type { SourceData } from "./sourceData"

export interface SourceEconomy {
  readonly key: number
  readonly maxIncome: number
  readonly spawnUsage: number
}

export function getSourceEconomy(room: Room, sourceData: SourceData): SourceEconomy {
  const runtime = getHarvestRuntime(room.name)

  runtime.sourceEconomyById ??= new Map()

  const key = room.energyCapacityAvailable
  const cached = runtime.sourceEconomyById.get(sourceData.sourceId)

  if (cached?.key === key) {
    return cached
  }

  const sourceEconomy = calculateSourceEconomy(room, sourceData)

  runtime.sourceEconomyById.set(sourceData.sourceId, sourceEconomy)

  return sourceEconomy
}

function calculateSourceEconomy(room: Room, sourceData: SourceData): SourceEconomy {
  const key = room.energyCapacityAvailable

  const grossIncome = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME

  const targetWork = Math.ceil(grossIncome / HARVEST_POWER)

  const minerBody = createMinerBody(room, sourceData.path, targetWork, true)

  if (!minerBody) {
    return { key, maxIncome: 0, spawnUsage: 0 }
  }
  let work = 0
  let move = 0
  let bodyCost = 0

  for (const part of minerBody) {
    bodyCost += BODYPART_COST[part]

    if (part === WORK) {
      work++
    } else if (part === MOVE) {
      move++
    }
  }

  const minerCount = Math.min(Math.ceil(targetWork / work), sourceData.miningPositions.length)

  const harvestIncome = Math.min(grossIncome, minerCount * work * HARVEST_POWER)

  const travelTicks = estimatePathTravelTicks(sourceData.path, move, work)

  const productiveLifetime = CREEP_LIFE_TIME - travelTicks

  const minerCost = (minerCount * bodyCost) / productiveLifetime

  const requiredCarryCapacity = sourceData.path.length * 2 * harvestIncome

  const carryParts = requiredCarryCapacity / CARRY_CAPACITY

  const haulerCost = (carryParts * (BODYPART_COST[CARRY] + BODYPART_COST[MOVE])) / CREEP_LIFE_TIME

  return {
    key,
    maxIncome: harvestIncome - minerCost - haulerCost,

    spawnUsage:
      (minerCount * minerBody.length * CREEP_SPAWN_TIME) / productiveLifetime +
      (carryParts * 2 * CREEP_SPAWN_TIME) / CREEP_LIFE_TIME,
  }
}
