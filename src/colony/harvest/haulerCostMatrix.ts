import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { intelStore } from "../../world/intel/intelStore"
import { forEachCoordinateAtRange } from "../../world/map/roomGrid"

const SOURCE_ADJACENT_COST = 20
const CACHE_MAX_UNUSED_TICKS = 1000
const CACHE_CLEANUP_INTERVAL = 100

interface HaulerCostMatrixCacheEntry {
  readonly baseMatrix?: CostMatrix
  readonly staticAvailableAt?: number
  readonly matrix: CostMatrix
  lastUsed: number
}

const cache = runtimeRegistry.createCache<string, HaulerCostMatrixCacheEntry>("harvest.haulerCostMatrix", {
  cleanupInterval: CACHE_CLEANUP_INTERVAL,
  cleanup: cleanupHaulerCostMatrixCache,
})

export function getHaulerRoomCostMatrix(roomName: string, baseMatrix: CostMatrix | undefined): CostMatrix | undefined {
  const intel = intelStore.get(roomName)

  if (intel === undefined || intel.sources.length === 0) {
    return baseMatrix
  }

  const cached = cache.get(roomName)

  if (
    cached !== undefined &&
    cached.baseMatrix === baseMatrix &&
    cached.staticAvailableAt === intel.staticAvailableAt
  ) {
    cached.lastUsed = Game.time
    return cached.matrix
  }

  const matrix = baseMatrix?.clone() ?? new PathFinder.CostMatrix()

  applyHaulerSourceCosts(matrix, roomName)

  cache.set(roomName, {
    baseMatrix,
    staticAvailableAt: intel.staticAvailableAt,
    matrix,
    lastUsed: Game.time,
  })

  return matrix
}

export function applyHaulerSourceCosts(matrix: CostMatrix, roomName: string): void {
  const intel = intelStore.get(roomName)

  if (intel === undefined) {
    return
  }

  for (const source of intel.sources) {
    forEachCoordinateAtRange(source.coordinate, 1, (x, y) => {
      const currentCost = matrix.get(x, y)

      if (currentCost === 255 || currentCost >= SOURCE_ADJACENT_COST) {
        return
      }

      matrix.set(x, y, SOURCE_ADJACENT_COST)
    })
  }
}

function cleanupHaulerCostMatrixCache(targetCache: Map<string, HaulerCostMatrixCacheEntry>): void {
  for (const [roomName, entry] of targetCache) {
    if (Game.time - entry.lastUsed > CACHE_MAX_UNUSED_TICKS) {
      targetCache.delete(roomName)
    }
  }
}
