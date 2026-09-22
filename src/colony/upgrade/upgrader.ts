export const UPGRADER_ROLE = "upgrader"

const CARRY_ENERGY_PER_WORK = 6
const WORK_PER_MOVE = 10

export function createUpgraderBody(roomName: string, targetWork: number): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return
  }

  const budget = room.energyCapacityAvailable

  for (let work = targetWork; work >= 1; work--) {
    const carry = Math.max(1, Math.ceil((work * CARRY_ENERGY_PER_WORK) / CARRY_CAPACITY))

    const move = Math.max(1, Math.ceil(work / WORK_PER_MOVE))

    const parts = work + carry + move
    const cost = work * BODYPART_COST[WORK] + carry * BODYPART_COST[CARRY] + move * BODYPART_COST[MOVE]

    if (parts > MAX_CREEP_SIZE || cost > budget) {
      continue
    }

    return [
      ...Array<BodyPartConstant>(work).fill(WORK),
      ...Array<BodyPartConstant>(carry).fill(CARRY),
      ...Array<BodyPartConstant>(move).fill(MOVE),
    ]
  }

  return
}
