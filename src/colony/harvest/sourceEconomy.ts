import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody } from "./miner"
import type { HarvestSourceData } from "./sourceData"

export interface SourceEconomy {
  readonly energyCapacity: number
  readonly grossIncome: number
  readonly targetWork: number
  readonly maxIncome: number
  readonly spawnUsage: number
}

export function getSourceEconomy(
  room: Room,
  sourceData: HarvestSourceData,
  grossIncome: number,
  targetWork: number,
): SourceEconomy {
  const runtime = getHarvestRuntime(room.name)

  runtime.sourceEconomyById ??= new Map()

  const energyCapacity = room.energyCapacityAvailable
  const cached = runtime.sourceEconomyById.get(sourceData.sourceId)

  if (
    cached?.energyCapacity === energyCapacity &&
    cached.grossIncome === grossIncome &&
    cached.targetWork === targetWork
  ) {
    return cached
  }

  const sourceEconomy = calculateSourceEconomy(room, sourceData, grossIncome, targetWork)

  runtime.sourceEconomyById.set(sourceData.sourceId, sourceEconomy)

  return sourceEconomy
}

function calculateSourceEconomy(
  room: Room,
  sourceData: HarvestSourceData,
  grossIncome: number,
  targetWork: number,
): SourceEconomy {
  const energyCapacity = room.energyCapacityAvailable

  const minerBody = createMinerBody(room, sourceData.path, targetWork, true)

  if (!minerBody) {
    return { energyCapacity, grossIncome, targetWork, maxIncome: 0, spawnUsage: 0 }
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
    energyCapacity,
    grossIncome,
    targetWork,
    maxIncome: harvestIncome - minerCost - haulerCost,

    spawnUsage:
      (minerCount * minerBody.length * CREEP_SPAWN_TIME) / productiveLifetime +
      (carryParts * 2 * CREEP_SPAWN_TIME) / CREEP_LIFE_TIME,
  }
}
