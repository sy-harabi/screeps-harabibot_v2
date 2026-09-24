import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { intelStore } from "../../world/intel/intelStore"
import { dijkstraMap } from "../../world/map/dijkstraMap"
import { getRange, type RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange, forEachCoordinateInRange, toRoomIndex } from "../../world/map/roomGrid"
import { getRoomType } from "../../world/map/roomTopology"
import { getBaseRoomCostMatrix } from "./roomCostMatrix"

const SOURCE_KEEPER_DANGER_RANGE = 3
const SOURCE_KEEPER_DANGER_COST = 255

const CACHE_MAX_UNUSED_TICKS = 1000
const CACHE_CLEANUP_INTERVAL = 100

interface SourceKeeperCostCacheEntry {
  readonly baseMatrix?: CostMatrix
  readonly matrix: CostMatrix
  lastUsed: number
}

const cache = runtimeRegistry.createCache("sourceKeeperCostsMatrix", {
  cleanupInterval: CACHE_CLEANUP_INTERVAL,
  cleanup: cleanupSourceKeeperCostMatrixCache,
})

function cleanupSourceKeeperCostMatrixCache(targetCache: Map<string, SourceKeeperCostCacheEntry>): void {
  for (const [roomName, entry] of targetCache) {
    if (Game.time - entry.lastUsed > CACHE_MAX_UNUSED_TICKS) {
      targetCache.delete(roomName)
    }
  }
}

export function getSourceKeeperCostMatrix(roomName: string): CostMatrix | undefined {
  const baseMatrix = getBaseRoomCostMatrix(roomName)

  const roomType = getRoomType(roomName)

  if (roomType !== "keeper") {
    return baseMatrix
  }

  const intel = intelStore.get(roomName)

  if (!intel) {
    return baseMatrix
  }

  const cached = cache.get(roomName)

  if (cached && cached.baseMatrix === baseMatrix) {
    cached.lastUsed = Game.time
    return cached.matrix
  }

  const terrain = Game.map.getRoomTerrain(roomName)

  const matrix = baseMatrix?.clone() ?? new PathFinder.CostMatrix()

  const resourceCoords: RoomCoordinate[] = []

  intel.sources.forEach((sourceIntel) => {
    resourceCoords.push(sourceIntel.coordinate)
  })

  intel.minerals.forEach((mineralIntel) => {
    resourceCoords.push(mineralIntel.coordinate)
  })

  for (const lairCood of intel.keeperLairs) {
    const resourceCoord = findKeeperResource(lairCood, resourceCoords)

    if (!resourceCoord) {
      continue
    }

    const distances = dijkstraMap(
      terrain,
      [lairCood],
      (_x, _y, terrainType) => (terrainType === TERRAIN_MASK_SWAMP ? 5 : 1),
      (x, y) => getRange({ x, y }, lairCood) <= 7,
    )

    let closests: RoomCoordinate[] = []
    let closestDistance = Infinity

    forEachCoordinateAtRange(resourceCoord, 1, (x, y) => {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        return
      }

      const distance = distances[toRoomIndex(x, y)]

      if (distance < 0) {
        return
      }

      if (distance < closestDistance) {
        closestDistance = distance
        closests = [{ x, y }]
        return
      }

      if (distance === closestDistance) {
        closests.push({ x, y })
        return
      }
    })

    for (const closeset of closests) {
      forEachCoordinateInRange(closeset, SOURCE_KEEPER_DANGER_RANGE, (x, y) => {
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
          return
        }

        matrix.set(x, y, SOURCE_KEEPER_DANGER_COST)
      })
    }
  }

  cache.set(roomName, {
    baseMatrix,
    matrix,
    lastUsed: Game.time,
  })

  return matrix
}

function findKeeperResource(lair: RoomCoordinate, resources: readonly RoomCoordinate[]): RoomCoordinate | undefined {
  let closest: RoomCoordinate | undefined
  let closestRange = Infinity

  for (const resource of resources) {
    const range = getRange(lair, resource)
    if (range < closestRange) {
      closest = resource
      closestRange = range
    }
  }

  return closest
}
