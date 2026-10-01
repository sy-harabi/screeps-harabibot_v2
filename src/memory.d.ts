import { type RemoteConstructionMemory } from "./colony/harvest/remoteConstruction"
import type { RclProgressMemory } from "./colony/rclProgress"
import type { CreepAssignment } from "./creeps/creepAssignment"
import type { BotOptionsOverride } from "./options/botOptions"
import type { IntelMemory } from "./world/intel/roomDynamicIntelMemory"

declare global {
  interface Memory {
    options?: BotOptionsOverride
    intel?: IntelMemory
  }

  interface RoomMemory {
    rclProgress?: RclProgressMemory
    remoteConstruction?: RemoteConstructionMemory
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: string

    sourceId?: Id<Source>
    haulerState?: "idle" | "fetching" | "loading" | "delivering"

    remoteRoomName?: string
  }
}
