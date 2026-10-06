export const BODY_PART_MAX_HITS = 100

export interface CreepBodyPart {
  readonly type: BodyPartConstant
  readonly hits: number
  readonly boost?: MineralBoostConstant
}

export type CreepBody = readonly CreepBodyPart[]
