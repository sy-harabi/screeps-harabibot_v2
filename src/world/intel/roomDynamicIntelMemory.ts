import { IntelMemory } from "./intelMemory"
import { packDynamicIntel, unpackDynamicIntel } from "./roomIntel"
import type { PackedRoomDynamicIntel, RoomDynamicIntel } from "./roomIntel"

export const roomDynamicIntelMemory = {
  has,
  get,
  set,
}

function has(roomName: string): boolean {
  return Memory.intel?.dynamic[roomName] !== undefined
}

function getMemory(): IntelMemory {
  Memory.intel ??= {
    dynamic: {},
    creeps: {},
  }

  return Memory.intel
}

function get(roomName: string): RoomDynamicIntel | undefined {
  const packed = getMemory().dynamic[roomName]

  return packed === undefined ? undefined : unpackDynamicIntel(packed)
}

function set(roomName: string, intel: RoomDynamicIntel): void {
  getMemory().dynamic[roomName] = packDynamicIntel(intel)
}
