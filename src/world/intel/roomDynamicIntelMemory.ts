import { getIntelMemory } from "./intelMemory"
import { packDynamicIntel, unpackDynamicIntel } from "./roomIntel"
import type { RoomDynamicIntel } from "./roomIntel"

export const roomDynamicIntelMemory = {
  has,
  get,
  set,
}

function has(roomName: string): boolean {
  return Memory.intel?.dynamic[roomName] !== undefined
}

function get(roomName: string): RoomDynamicIntel | undefined {
  const packed = getIntelMemory().dynamic[roomName]

  return packed === undefined ? undefined : unpackDynamicIntel(packed)
}

function set(roomName: string, intel: RoomDynamicIntel): void {
  getIntelMemory().dynamic[roomName] = packDynamicIntel(intel)
}
