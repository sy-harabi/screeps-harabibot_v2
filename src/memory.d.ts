import type { CreepAssignment } from "./creeps/creepAssignment"
import type { BotOptionsOverride } from "./options/botOptions"
import type { IntelMemory } from "./world/intel/roomDynamicIntelMemory"

declare global {
  interface Memory {
    options?: BotOptionsOverride
    intel?: IntelMemory
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: string
    sourceId?: Id<Source>
    delivering?: boolean
  }
}
