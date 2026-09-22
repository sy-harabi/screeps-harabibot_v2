import { dijkstraMap } from "../../world/map/dijkstraMap"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { toRoomIndex } from "../../world/map/roomGrid"

export function buildResourceDistanceMap(
  terrain: RoomTerrain,
  resourceRoadBlockedMask: Uint8Array,
  coreRoads: readonly RoomCoordinate[],
): Int32Array {
  return dijkstraMap(
    terrain,
    coreRoads,
    getResourceRoadCost,
    (x, y) => resourceRoadBlockedMask[toRoomIndex(x, y)] === 0,
  )
}

export function getResourceRoadCost(_x: number, _y: number, terrainType: number): number {
  return terrainType === TERRAIN_MASK_SWAMP ? 6 : 5
}
