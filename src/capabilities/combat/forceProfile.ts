import {
  BODY_PART_HITS,
  CREEP_CAPABILITY,
  TOUGH_TIER_DAMAGE_MULTIPLIERS,
  type CreepCapabilities,
} from "../../creeps/creepCapabilities"

export interface ForceProfile {
  readonly creepCount: number

  readonly attack: number
  readonly rangedAttack: number
  readonly heal: number
  readonly rangedHeal: number
  readonly dismantle: number

  readonly hits: number
  readonly additionalEffectiveHits: number
  readonly healAmplification: number
}

export function createForceProfile(capabilities: readonly CreepCapabilities[]): ForceProfile {
  let hits = 0,
    heal = 0,
    attack = 0,
    rangedAttack = 0,
    dismantle = 0,
    toughTier1Hits = 0,
    toughTier2Hits = 0,
    toughTier3Hits = 0

  for (const creep of capabilities) {
    hits += creep[CREEP_CAPABILITY.bodySize] * BODY_PART_HITS

    attack += creep[CREEP_CAPABILITY.attack] * ATTACK_POWER
    rangedAttack += creep[CREEP_CAPABILITY.rangedAttack] * RANGED_ATTACK_POWER
    heal += creep[CREEP_CAPABILITY.heal] * HEAL_POWER
    dismantle += creep[CREEP_CAPABILITY.dismantle] * DISMANTLE_POWER

    toughTier1Hits += creep[CREEP_CAPABILITY.toughTier1Hits]
    toughTier2Hits += creep[CREEP_CAPABILITY.toughTier2Hits]
    toughTier3Hits += creep[CREEP_CAPABILITY.toughTier3Hits]
  }

  const additionalEffectiveHits =
    getAdditionalEffectiveHits(toughTier1Hits, TOUGH_TIER_DAMAGE_MULTIPLIERS[0]) +
    getAdditionalEffectiveHits(toughTier2Hits, TOUGH_TIER_DAMAGE_MULTIPLIERS[1]) +
    getAdditionalEffectiveHits(toughTier3Hits, TOUGH_TIER_DAMAGE_MULTIPLIERS[2])

  let remainingHeal = heal
  let healAmplification = 0

  const tier3Heal = Math.min(remainingHeal, toughTier3Hits)
  healAmplification += getAdditionalEffectiveHits(tier3Heal, TOUGH_TIER_DAMAGE_MULTIPLIERS[2])
  remainingHeal -= tier3Heal

  const tier2Heal = Math.min(remainingHeal, toughTier2Hits)
  healAmplification += getAdditionalEffectiveHits(tier2Heal, TOUGH_TIER_DAMAGE_MULTIPLIERS[1])
  remainingHeal -= tier2Heal

  const tier1Heal = Math.min(remainingHeal, toughTier1Hits)
  healAmplification += getAdditionalEffectiveHits(tier1Heal, TOUGH_TIER_DAMAGE_MULTIPLIERS[0])

  return {
    creepCount: capabilities.length,
    attack,
    rangedAttack,
    heal,
    rangedHeal: (heal / HEAL_POWER) * RANGED_HEAL_POWER,
    dismantle,
    hits,
    additionalEffectiveHits,
    healAmplification,
  }
}

function getAdditionalEffectiveHits(hits: number, damageMultiplier: number): number {
  return hits * (1 / damageMultiplier - 1)
}
