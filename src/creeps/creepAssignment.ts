export type CreepAssignment =
  | {
      readonly type: "colony"
      readonly colonyName: string
    }
  | {
      readonly type: "mission"
      readonly missionId: string
    }
