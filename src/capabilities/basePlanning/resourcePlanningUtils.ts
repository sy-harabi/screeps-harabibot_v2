import { dijkstraMap } from "../../world/map/dijkstraMap"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange, ROOM_AREA, toRoomIndex } from "../../world/map/roomGrid"

const SOURCE_ADJACENT_COST = 20

export function buildSourceAvoidanceMask(terrain: RoomTerrain, sources: readonly Source[]): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)

  for (const source of sources) {
    forEachCoordinateAtRange(source.pos, 1, (x, y) => {
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        mask[toRoomIndex(x, y)] = 1
      }
    })
  }

  return mask
}

export function buildResourceDistanceMap(
  terrain: RoomTerrain,
  resourceRoadBlockedMask: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
  sourceAvoidanceMask: Uint8Array,
): Int32Array {
  return dijkstraMap(
    terrain,
    coreRoads,
    (x, y, terrainType) => getResourceRoadCost(x, y, terrainType, sourceAvoidanceMask),
    (x, y) => resourceRoadBlockedMask[toRoomIndex(x, y)] === 0,
  )
}

export function getResourceRoadCost(
  x: number,
  y: number,
  terrainType: number,
  sourceAvoidanceMask: Uint8Array,
): number {
  if (sourceAvoidanceMask[toRoomIndex(x, y)]) {
    return SOURCE_ADJACENT_COST
  }

  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5
}
