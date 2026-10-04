import type { HarvestMemory } from "./colony/harvest/harvestMemory"
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
    harvest?: HarvestMemory
    use21Hauler?: boolean
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: string

    sourceId?: Id<Source>
    haulerState?: "idle" | "fetching" | "loading" | "delivering"
    haulerProfile?: "1:1" | "2:1"
    haulerLoadingSince?: number

    remoteRoomName?: string

    remoteBuilderState?: "fetching" | "loading" | "building"
    remoteRepairerState?: "working" | "fetching" | "loading"
  }
}
