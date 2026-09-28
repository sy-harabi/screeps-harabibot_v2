import type { BasePlan } from "../basePlanning/basePlan"
import { basePlanStore } from "../basePlanning/basePlanStore"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { getBaseRoomCostMatrix } from "./roomCostMatrix"

const WORKING_POSITION_COST = 20

const CACHE_MAX_UNUSED_TICKS = 1000
const CACHE_CLEANUP_INTERVAL = 100

interface DefaultRoomCostMatrixCacheEntry {
  readonly baseMatrix?: CostMatrix
  readonly basePlanRevision: number
  readonly matrix: CostMatrix
  lastUsed: number
}

const cache = runtimeRegistry.createCache<string, DefaultRoomCostMatrixCacheEntry>("defaultRoomCostMatrix", {
  cleanupInterval: CACHE_CLEANUP_INTERVAL,
  cleanup: cleanupDefaultRoomCostMatrixCache,
})

export function getDefaultRoomCostMatrix(roomName: string): CostMatrix | undefined {
  const baseMatrix = getBaseRoomCostMatrix(roomName)
  const room = Game.rooms[roomName]

  if (room?.controller?.my !== true) {
    return baseMatrix
  }

  const basePlanResult = basePlanStore.get(roomName)

  if (basePlanResult.status !== "ready") {
    return baseMatrix
  }

  const basePlan = basePlanResult.value
  const cached = cache.get(roomName)

  if (cached !== undefined && cached.baseMatrix === baseMatrix && cached.basePlanRevision === basePlan.revision) {
    cached.lastUsed = Game.time
    return cached.matrix
  }

  const matrix = buildDefaultRoomCostMatrix(baseMatrix, basePlan)

  cache.set(roomName, {
    baseMatrix,
    basePlanRevision: basePlan.revision,
    matrix,
    lastUsed: Game.time,
  })

  return matrix
}

function buildDefaultRoomCostMatrix(baseMatrix: CostMatrix | undefined, basePlan: BasePlan): CostMatrix {
  const matrix = baseMatrix?.clone() ?? new PathFinder.CostMatrix()

  for (const structure of basePlan.structures) {
    if (structure.structureType !== STRUCTURE_CONTAINER || structure.tag?.kind !== "source") {
      continue
    }

    setWorkingPositionCost(matrix, structure.coordinate)
  }

  const { left, middle, right } = basePlan.controller.upgradeChains

  for (const chain of [left, middle, right]) {
    for (const coordinate of chain) {
      setWorkingPositionCost(matrix, coordinate)
    }
  }

  return matrix
}

function setWorkingPositionCost(matrix: CostMatrix, coordinate: RoomCoordinate): void {
  const currentCost = matrix.get(coordinate.x, coordinate.y)

  if (currentCost === 255 || currentCost >= WORKING_POSITION_COST) {
    return
  }

  matrix.set(coordinate.x, coordinate.y, WORKING_POSITION_COST)
}

function cleanupDefaultRoomCostMatrixCache(
  targetCache: Map<string, DefaultRoomCostMatrixCacheEntry>,
): void {
  for (const [roomName, entry] of targetCache) {
    if (Game.time - entry.lastUsed > CACHE_MAX_UNUSED_TICKS) {
      targetCache.delete(roomName)
    }
  }
}
