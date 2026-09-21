import type { CreepAssignment } from "./creeps/creepAssignment"
import type { BotOptionsOverride } from "./options/botOptions"

declare global {
  interface Memory {
    options?: BotOptionsOverride
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: string
    sourceId?: Id<Source>
    delivering?: boolean
  }
}
