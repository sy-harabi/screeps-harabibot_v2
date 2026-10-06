import type { ForceProfile } from "./forceProfile"

const HEAL_AMPLIFICATION_FACTOR = 0.6

export interface TimeToDefeat {
  readonly timeToKill: number
  readonly timeToDie: number
}

export interface CombatEstimate {
  readonly close: TimeToDefeat
  readonly ranged: TimeToDefeat
}

export function estimateCombat(friendly: ForceProfile, hostile: ForceProfile): CombatEstimate {
  const friendlyEffectiveHits = friendly.hits + friendly.additionalEffectiveHits
  const hostileEffectiveHits = hostile.hits + hostile.additionalEffectiveHits

  const friendlySustain = friendly.heal + friendly.healAmplification * HEAL_AMPLIFICATION_FACTOR
  const hostileSustain = hostile.heal + hostile.healAmplification * HEAL_AMPLIFICATION_FACTOR

  const friendlyCloseDamage = friendly.attack + friendly.rangedAttack
  const hostileCloseDamage = hostile.attack + hostile.rangedAttack

  const friendlyCloseNetDamage = Math.max(0, friendlyCloseDamage - hostileSustain)
  const hostileCloseNetDamage = Math.max(0, hostileCloseDamage - friendlySustain)

  const closeTimeToKill =
    hostileEffectiveHits <= 0
      ? 0
      : friendlyCloseNetDamage > 0
        ? hostileEffectiveHits / friendlyCloseNetDamage
        : Infinity

  const closeTimeToDie =
    friendlyEffectiveHits <= 0
      ? 0
      : hostileCloseNetDamage > 0
        ? friendlyEffectiveHits / hostileCloseNetDamage
        : Infinity

  const friendlyRangedNetDamage = Math.max(0, friendly.rangedAttack - hostileSustain)
  const hostileRangedNetDamage = Math.max(0, hostile.rangedAttack - friendlySustain)

  const rangedTimeToKill =
    hostileEffectiveHits <= 0
      ? 0
      : friendlyRangedNetDamage > 0
        ? hostileEffectiveHits / friendlyRangedNetDamage
        : Infinity

  const rangedTimeToDie =
    friendlyEffectiveHits <= 0
      ? 0
      : hostileRangedNetDamage > 0
        ? friendlyEffectiveHits / hostileRangedNetDamage
        : Infinity

  return {
    close: {
      timeToKill: closeTimeToKill,
      timeToDie: closeTimeToDie,
    },
    ranged: {
      timeToKill: rangedTimeToKill,
      timeToDie: rangedTimeToDie,
    },
  }
}
