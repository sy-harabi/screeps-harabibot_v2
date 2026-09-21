import type { OperationsMemory } from "./operations/operation"
import type { BotOptionsOverride } from "./options/botOptions"

type CreepAssignment =
  | {
      type: "colony"
      colonyName: string
    }
  | {
      type: "mission"
      missionId: string
    }

declare global {
  interface Memory {
    operations: OperationsMemory
    options?: BotOptionsOverride
  }

  interface CreepMemory {
    assignment?: CreepAssignment
    role: string
    sourceId?: Id<Source>
    delivering?: boolean
  }
}
