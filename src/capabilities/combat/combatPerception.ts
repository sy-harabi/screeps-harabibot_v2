import type { CreepBody } from "../../creeps/creepBody"
import { creepIntelStore } from "../../world/intel/creepIntelStore"
import { createForceProfile, type ForceProfile } from "./forceProfile"

export function getForeignCombatForceProfile(roomName: string): ForceProfile {
  const bodies: CreepBody[] = []

  for (const id of creepIntelStore.getForeignCreepIds(roomName)) {
    const intel = creepIntelStore.get(id)

    if (intel === undefined || !isCombatant(intel.body)) {
      continue
    }

    bodies.push(intel.body)
  }

  return createForceProfile(bodies)
}

export function isCombatant(body: CreepBody): boolean {
  return body.some(
    (part) =>
      part.hits > 0 && (part.type === ATTACK || part.type === RANGED_ATTACK || part.type === HEAL),
  )
}
