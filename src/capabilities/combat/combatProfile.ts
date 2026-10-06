export interface CombatProfile {
  readonly attack: number
  readonly rangedAttack: number

  readonly heal: number
  readonly rangedHeal: number

  readonly dismantle: number

  readonly hits: number
  readonly effectiveHits: number
}
