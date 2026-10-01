export const REMOTE_BUILDER_ROLE = "remoteBuilder"

const REMOTE_BUILDER_UNIT_WORK = 3
const REMOTE_BUILDER_UNIT_CARRY = 5
const REMOTE_BUILDER_UNIT_MOVE = 4

export const REMOTE_BUILDER_TARGET_WORK = 6
export const REMOTE_BUILDER_UNIT_COST = 750

export function createRemoteBuilderBody(room: Room, missingWork: number): readonly BodyPartConstant[] | undefined {
  const maxUnits = Math.floor(room.energyCapacityAvailable / REMOTE_BUILDER_UNIT_COST)

  if (maxUnits <= 0) {
    return
  }

  const neededUnits = Math.ceil(missingWork / REMOTE_BUILDER_UNIT_WORK)

  const units = Math.min(maxUnits, neededUnits)

  if (units <= 0) {
    return
  }

  return [
    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_WORK).fill(WORK),

    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_CARRY).fill(CARRY),

    ...Array<BodyPartConstant>(units * REMOTE_BUILDER_UNIT_MOVE).fill(MOVE),
  ]
}
