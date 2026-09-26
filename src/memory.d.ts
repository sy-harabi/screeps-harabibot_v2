import type { CreepAssignment } from "./creeps/creepAssignment"
import type { BotOptionsOverride } from "./options/botOptions"
import type { PackedRoomDynamicIntel } from "./world/intel/roomIntel"

declare global {
  interface Memory {
    options?: BotOptionsOverride
  }

  interface RoomMemory {
    intel?: PackedRoomDynamicIntel
    lastRemoteCheckTick?: number
    needsRemoteInitialization?: boolean
  }

  interface CreepMemory {
    assignment: CreepAssignment
    role: string
    sourceId?: Id<Source>
    remoteRoomName?: string
    delivering?: boolean
  }
}
