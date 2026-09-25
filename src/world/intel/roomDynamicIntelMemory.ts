import { packDynamicIntel, unpackDynamicIntel } from "./roomIntel"
import type { RoomDynamicIntel } from "./roomIntel"

export const roomDynamicIntelMemory = {
  has,
  get,
  set,
}

function has(roomName: string): boolean {
  return Memory.rooms?.[roomName]?.intel !== undefined
}

function get(roomName: string): RoomDynamicIntel | undefined {
  const packed = Memory.rooms?.[roomName]?.intel

  return packed === undefined ? undefined : unpackDynamicIntel(packed)
}

function set(roomName: string, intel: RoomDynamicIntel): void {
  Memory.rooms ??= {}
  const memory = (Memory.rooms[roomName] ??= {})

  memory.intel = packDynamicIntel(intel)
}
