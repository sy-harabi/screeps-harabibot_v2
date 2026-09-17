import type { RoomCoordinate } from "../../world/map/roomCoordinate"

const NUM_SPAWNS = 3

export interface SpawnPlanningInfo {
  readonly coreSpawnOrdinal: number
  readonly slotSpawnOrdinalStart: number
  readonly requiredSlotSpawns: number
}

export function getSpawnPlanningInfo(
  existingSpawn: RoomCoordinate | undefined,
  coreSpawn: RoomCoordinate,
): SpawnPlanningInfo {
  const hasSeparateExistingSpawn = existingSpawn !== undefined && !isSameCoordinate(existingSpawn, coreSpawn)
  const fixedSpawnCount = hasSeparateExistingSpawn ? 2 : 1

  return {
    coreSpawnOrdinal: hasSeparateExistingSpawn ? 1 : 0,
    slotSpawnOrdinalStart: fixedSpawnCount,
    requiredSlotSpawns: NUM_SPAWNS - fixedSpawnCount,
  }
}

export function isSameCoordinate(left: RoomCoordinate, right: RoomCoordinate): boolean {
  return left.x === right.x && left.y === right.y
}
