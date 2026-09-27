import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody } from "./miner"

export interface SourceEconomy {
  readonly key: number
  readonly path: readonly RoomPosition[]
  readonly numMiningPositions: number
  readonly grossIncome: number

  readonly maxIncome: number
  readonly spawnUsage: number
}

export function getSourceEconomy(
  room: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
  numMiningPositions: number,
  grossIncome: number,
): SourceEconomy {
  const runtime = getHarvestRuntime(room.name)

  runtime.sourceEconomyById ??= new Map()

  const key = room.energyCapacityAvailable
  const cached = runtime.sourceEconomyById.get(sourceId)

  if (
    cached?.key === key &&
    cached.path === path &&
    cached.numMiningPositions === numMiningPositions &&
    cached.grossIncome === grossIncome
  ) {
    return cached
  }

  const sourceEconomy = calculateSourceEconomy(room, path, numMiningPositions, grossIncome)

  runtime.sourceEconomyById.set(sourceId, sourceEconomy)

  return sourceEconomy
}

function calculateSourceEconomy(
  room: Room,
  path: readonly RoomPosition[],
  numMiningPositions: number,
  grossIncome: number,
): SourceEconomy {
  const key = room.energyCapacityAvailable
  const targetWork = Math.ceil(grossIncome / HARVEST_POWER)
  const minerBody = createMinerBody(room, path, targetWork, true)

  if (minerBody === undefined) {
    return {
      key,
      path,
      numMiningPositions,
      grossIncome,
      maxIncome: 0,
      spawnUsage: 0,
    }
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

  const minerCount = Math.min(Math.ceil(targetWork / work), numMiningPositions)
  const harvestIncome = Math.min(grossIncome, minerCount * work * HARVEST_POWER)
  const travelTicks = estimatePathTravelTicks(path, move, work)
  const productiveLifetime = CREEP_LIFE_TIME - travelTicks
  const minerCost = (minerCount * bodyCost) / productiveLifetime
  const requiredCarryCapacity = path.length * 2 * harvestIncome
  const carryParts = requiredCarryCapacity / CARRY_CAPACITY
  const haulerCost = (carryParts * (BODYPART_COST[CARRY] + BODYPART_COST[MOVE])) / CREEP_LIFE_TIME

  return {
    key,
    path,
    numMiningPositions,
    grossIncome,
    maxIncome: harvestIncome - minerCost - haulerCost,
    spawnUsage:
      (minerCount * minerBody.length * CREEP_SPAWN_TIME) / productiveLifetime +
      (carryParts * 2 * CREEP_SPAWN_TIME) / CREEP_LIFE_TIME,
  }
}
