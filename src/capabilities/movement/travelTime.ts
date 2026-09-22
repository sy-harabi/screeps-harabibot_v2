import { getBaseRoomCostMatrix } from "./roomCostMatrix"

export function estimatePathTravelTicks(path: readonly RoomPosition[], moveParts: number, weightParts: number): number {
  if (moveParts <= 0) {
    return Infinity
  }

  let ticks = 0

  for (const pos of path) {
    const terrainCost = getMovementTerrainCost(pos)

    const fatigue = weightParts * terrainCost
    const fatigueRecovery = moveParts * 2

    ticks += Math.max(1, Math.ceil(fatigue / fatigueRecovery))
  }

  return ticks
}

function getMovementTerrainCost(pos: RoomPosition): number {
  const costs = getBaseRoomCostMatrix(pos.roomName)

  if (costs?.get(pos.x, pos.y) === 1) {
    return 1
  }

  const terrain = Game.map.getRoomTerrain(pos.roomName)

  return terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP ? 10 : 2
}
