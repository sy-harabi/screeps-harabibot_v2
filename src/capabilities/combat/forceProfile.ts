import type { CreepBody } from "../../creeps/creepBody"

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

interface ToughHealPotential {
  readonly capacity: number
  readonly amplification: number
}

const boostTable: Record<string, Record<string, Record<string, number>>> = BOOSTS

export function createForceProfile(bodies: readonly CreepBody[]): ForceProfile {
  let hits = 0,
    additionalEffectiveHits = 0,
    heal = 0,
    rangedHeal = 0,
    attack = 0,
    rangedAttack = 0,
    dismantle = 0

  const toughHealPotentials: ToughHealPotential[] = []

  for (const body of bodies) {
    for (const part of body) {
      hits += part.hits

      if (part.hits <= 0) {
        continue
      }

      switch (part.type) {
        case ATTACK:
          attack += ATTACK_POWER * getBoostMultiplier(part, "attack")
          break

        case RANGED_ATTACK:
          rangedAttack += RANGED_ATTACK_POWER * getBoostMultiplier(part, "rangedAttack")
          break

        case HEAL:
          heal += HEAL_POWER * getBoostMultiplier(part, "heal")
          rangedHeal += RANGED_HEAL_POWER * getBoostMultiplier(part, "rangedHeal")
          break

        case WORK:
          dismantle += DISMANTLE_POWER * getBoostMultiplier(part, "dismantle")
          break
      }

      if (part.boost === undefined) {
        continue
      }

      const damageMultiplier = boostTable[TOUGH]?.[part.boost]?.damage ?? 1

      if (damageMultiplier === 1) {
        continue
      }

      const amplification = 1 / damageMultiplier - 1

      additionalEffectiveHits += part.hits * amplification

      toughHealPotentials.push({
        capacity: part.hits,
        amplification,
      })
    }
  }

  toughHealPotentials.sort((left, right) => right.amplification - left.amplification)

  let remainingHeal = heal
  let healAmplification = 0

  for (const potential of toughHealPotentials) {
    if (remainingHeal <= 0) {
      break
    }

    const appliedHeal = Math.min(remainingHeal, potential.capacity)

    healAmplification += appliedHeal * potential.amplification
    remainingHeal -= appliedHeal
  }

  return {
    creepCount: bodies.length,
    attack,
    rangedAttack,
    heal,
    rangedHeal,
    dismantle,
    hits,
    additionalEffectiveHits,
    healAmplification,
  }
}

function getBoostMultiplier(part: CreepBody[number], action: string): number {
  if (part.boost === undefined) {
    return 1
  }

  return boostTable[part.type]?.[part.boost]?.[action] ?? 1
}
