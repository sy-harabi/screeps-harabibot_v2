export const BODY_PART_HITS = 100

export const CREEP_CAPABILITY = {
  bodySize: 0,

  moveParts: 1,
  move: 2,

  attack: 3,
  rangedAttack: 4,
  heal: 5,

  harvest: 6,
  buildRepair: 7,
  dismantle: 8,
  upgradeController: 9,

  carry: 10,
  claim: 11,

  toughTier1Hits: 12,
  toughTier2Hits: 13,
  toughTier3Hits: 14,
} as const

export const TOUGH_TIER_DAMAGE_MULTIPLIERS = [0.7, 0.5, 0.3] as const

export type CreepCapabilities = readonly [
  bodySize: number,

  moveParts: number,
  move: number,

  attack: number,
  rangedAttack: number,
  heal: number,

  harvest: number,
  buildRepair: number,
  dismantle: number,
  upgradeController: number,

  carry: number,
  claim: number,

  toughTier1Hits: number,
  toughTier2Hits: number,
  toughTier3Hits: number,
]

type CreepBodyPartInput =
  | BodyPartConstant
  | {
      readonly type: BodyPartConstant
      readonly boost?: MineralBoostConstant
    }

const boostTable: Record<string, Record<string, Record<string, number>>> = BOOSTS

let cacheTick = -1

const capabilitiesByCreepId = new Map<Id<Creep>, CreepCapabilities>()

export function analyzeCreepBody(body: readonly CreepBodyPartInput[]): CreepCapabilities {
  let moveParts = 0,
    move = 0,
    attack = 0,
    rangedAttack = 0,
    heal = 0,
    harvest = 0,
    buildRepair = 0,
    dismantle = 0,
    upgradeController = 0,
    carry = 0,
    claim = 0,
    toughTier1Hits = 0,
    toughTier2Hits = 0,
    toughTier3Hits = 0

  for (const part of body) {
    const type = typeof part === "string" ? part : part.type
    const boost = typeof part === "string" ? undefined : part.boost

    switch (type) {
      case MOVE:
        moveParts++
        move += getBoostMultiplier(type, boost, "fatigue")
        break

      case ATTACK:
        attack += getBoostMultiplier(type, boost, "attack")
        break

      case RANGED_ATTACK:
        rangedAttack += getBoostMultiplier(type, boost, "rangedAttack")
        break

      case HEAL:
        heal += getBoostMultiplier(type, boost, "heal")
        break

      case WORK:
        harvest += getBoostMultiplier(type, boost, "harvest")
        buildRepair += getBoostMultiplier(type, boost, "build")
        dismantle += getBoostMultiplier(type, boost, "dismantle")
        upgradeController += getBoostMultiplier(type, boost, "upgradeController")
        break

      case CARRY:
        carry += getBoostMultiplier(type, boost, "capacity")
        break

      case CLAIM:
        claim++
        break

      case TOUGH: {
        const damageMultiplier = getBoostMultiplier(type, boost, "damage")

        if (damageMultiplier === TOUGH_TIER_DAMAGE_MULTIPLIERS[0]) {
          toughTier1Hits += BODY_PART_HITS
        } else if (damageMultiplier === TOUGH_TIER_DAMAGE_MULTIPLIERS[1]) {
          toughTier2Hits += BODY_PART_HITS
        } else if (damageMultiplier === TOUGH_TIER_DAMAGE_MULTIPLIERS[2]) {
          toughTier3Hits += BODY_PART_HITS
        }

        break
      }
    }
  }

  return [
    body.length,

    moveParts,
    move,

    attack,
    rangedAttack,
    heal,

    harvest,
    buildRepair,
    dismantle,
    upgradeController,

    carry,
    claim,

    toughTier1Hits,
    toughTier2Hits,
    toughTier3Hits,
  ]
}

export function getCreepCapabilities(creep: Creep): CreepCapabilities {
  if (cacheTick !== Game.time) {
    cacheTick = Game.time
    capabilitiesByCreepId.clear()
  }

  const cached = capabilitiesByCreepId.get(creep.id)

  if (cached !== undefined) {
    return cached
  }

  const capabilities = analyzeCreepBody(creep.body)

  capabilitiesByCreepId.set(creep.id, capabilities)

  return capabilities
}

function getBoostMultiplier(type: BodyPartConstant, boost: MineralBoostConstant | undefined, action: string): number {
  if (boost === undefined) {
    return 1
  }

  return boostTable[type]?.[boost]?.[action] ?? 1
}
