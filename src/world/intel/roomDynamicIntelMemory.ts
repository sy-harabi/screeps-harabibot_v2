import { packDynamicIntel, PackedRoomDynamicIntel, RoomDynamicIntel, unpackDynamicIntel } from "./roomIntel"

export interface IntelMemory {
  dynamic: Record<string, PackedRoomDynamicIntel>
}

export const roomDynamicIntelMemory = {
  get,
  set,
}

function getMemory(): IntelMemory {
  Memory.intel ??= {
    dynamic: {},
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
