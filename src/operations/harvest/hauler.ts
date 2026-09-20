export const HAULER_ROLE = "hauler"

export function createHaulerBody(roomName: string): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 300) {
    return undefined
  }

  const unit = [CARRY, MOVE]

  const unitCost = unit.reduce((prev, curr) => prev + BODYPART_COST[curr], 0)

  const carryCount = Math.min(Math.max(1, Math.floor(budget / unitCost)), Math.floor(MAX_CREEP_SIZE / unit.length))

  const result: BodyPartConstant[] = []

  for (let i = 0; i < carryCount; i++) {
    result.push(...unit)
  }

  return result
}
