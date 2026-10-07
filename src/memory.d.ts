import type { HarvestMemory } from "./colony/harvest/harvestMemory"
import type { HaulerProfile, HaulTask } from "./colony/harvest/harvestState"
import type { RclProgressMemory } from "./colony/rclProgress"
import type { CreepAssignment } from "./creeps/creepAssignment"
import type { CreepRole } from "./creeps/creepRole"
import { MissionId } from "./missions/mission"
import { MissionMemory } from "./missions/missionMemory"
import type { BotOptionsOverride } from "./options/botOptions"
import { type IntelMemory } from "./world/intel/intelMemory"

declare global {
  interface Memory {
    options?: BotOptionsOverride
    intel?: IntelMemory
    missions?: Record<MissionId, MissionMemory>
  }

  interface RoomMemory {
    rclProgress?: RclProgressMemory
    harvest?: HarvestMemory
    use21Hauler?: boolean
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: CreepRole

    haulTask?: HaulTask
    sourceId?: Id<Source>
    haulerProfile?: HaulerProfile

    remoteRoomName?: string

    remoteBuilderState?: "fetching" | "loading" | "building"
    remoteRepairerState?: "working" | "fetching" | "loading"
  }
}
