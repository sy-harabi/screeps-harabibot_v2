import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getRequiredCarryCapacity } from "./hauler"
import type { HaulerProfile } from "./harvestState"
import { getHarvestRuntime } from "./harvestRuntime"
import { createMinerBody } from "./miner"

export interface SourceEconomyStats {
  readonly key: number
  readonly path: readonly RoomPosition[]
  readonly haulerCycleTravelTicks: number
  readonly haulerProfile: HaulerProfile
  readonly relayPathLength?: number

  readonly numMiningPositions: number
  readonly grossIncome: number
  readonly targetWork: number
  readonly hasContainer: boolean

  readonly harvestIncome: number
  readonly minerUpkeep: number
  readonly haulerUpkeep: number
  readonly infrastructureUpkeep: number
  readonly minerSpawnUsage: number
  readonly haulerSpawnUsage: number
}

export function getSourceEconomyStats(
  room: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
  numMiningPositions: number,
  grossIncome: number,
  targetWork: number,
  hasContainer: boolean,
  haulerCycleTravelTicks: number,
  haulerProfile: HaulerProfile,
  relayPathLength?: number,
): SourceEconomyStats {
  const runtime = getHarvestRuntime(room.name)

  runtime.sourceEconomyStatsById ??= new Map()

  const key = room.energyCapacityAvailable
  const cached = runtime.sourceEconomyStatsById.get(sourceId)

  if (
    cached?.key === key &&
    cached.path === path &&
    cached.numMiningPositions === numMiningPositions &&
    cached.grossIncome === grossIncome &&
    cached.targetWork === targetWork &&
    cached.hasContainer === hasContainer &&
    cached.haulerCycleTravelTicks === haulerCycleTravelTicks &&
    cached.haulerProfile === haulerProfile &&
    cached.relayPathLength === relayPathLength
  ) {
    return cached
  }

  const stats = calculateSourceEconomyStats(
    room,
    path,
    numMiningPositions,
    grossIncome,
    targetWork,
    hasContainer,
    haulerCycleTravelTicks,
    haulerProfile,
    relayPathLength,
  )

  runtime.sourceEconomyStatsById.set(sourceId, stats)

  return stats
}

function calculateSourceEconomyStats(
  room: Room,
  path: readonly RoomPosition[],
  numMiningPositions: number,
  grossIncome: number,
  targetWork: number,
  hasContainer: boolean,
  haulerCycleTravelTicks: number,
  haulerProfile: HaulerProfile,
  relayPathLength?: number,
): SourceEconomyStats {
  const key = room.energyCapacityAvailable
  const minerBody = createMinerBody(room, path, targetWork, true)

  if (minerBody === undefined) {
    return {
      key,
      path,
      haulerCycleTravelTicks,
      haulerProfile,
      relayPathLength,
      numMiningPositions,
      grossIncome,
      targetWork,
      hasContainer,
      harvestIncome: 0,
      minerUpkeep: 0,
      haulerUpkeep: 0,
      infrastructureUpkeep: 0,
      minerSpawnUsage: 0,
      haulerSpawnUsage: 0,
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
  const minerUpkeep = (minerCount * bodyCost) / productiveLifetime
  const requiredCarryCapacity = getRequiredCarryCapacity(harvestIncome, haulerCycleTravelTicks, relayPathLength)
  const carryParts = requiredCarryCapacity / CARRY_CAPACITY
  const haulerPartsPerCarry = haulerProfile === "2:1" ? 1.5 : 2
  const haulerEnergyPerCarry =
    haulerProfile === "2:1"
      ? BODYPART_COST[CARRY] + BODYPART_COST[MOVE] / 2
      : BODYPART_COST[CARRY] + BODYPART_COST[MOVE]
  const haulerUpkeep = (carryParts * haulerEnergyPerCarry) / CREEP_LIFE_TIME
  const sourceRoomName = path[path.length - 1]?.roomName
  const infrastructureUpkeep = hasContainer
    ? (CONTAINER_DECAY * REPAIR_COST) /
      (sourceRoomName === room.name ? CONTAINER_DECAY_TIME_OWNED : CONTAINER_DECAY_TIME)
    : minerCount

  return {
    key,
    path,
    haulerCycleTravelTicks,
    haulerProfile,
    relayPathLength,
    numMiningPositions,
    grossIncome,
    targetWork,
    hasContainer,
    harvestIncome,
    minerUpkeep,
    haulerUpkeep,
    infrastructureUpkeep,
    minerSpawnUsage: (minerCount * minerBody.length * CREEP_SPAWN_TIME) / productiveLifetime,
    haulerSpawnUsage: (carryParts * haulerPartsPerCarry * CREEP_SPAWN_TIME) / CREEP_LIFE_TIME,
  }
}
