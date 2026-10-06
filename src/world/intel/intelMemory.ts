import type { CreepIntel } from "./creepIntel"
import type { PackedRoomDynamicIntel } from "./roomIntel"

export interface IntelMemory {
  dynamic: Record<string, PackedRoomDynamicIntel>
  creeps: Record<string, CreepIntel>
}

export function getIntelMemory(): IntelMemory {
  Memory.intel ??= {
    dynamic: {},
    creeps: {},
  }

  return Memory.intel
}
