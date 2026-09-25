import { createRoomDynamicIntel, createRoomStaticIntel, mergeRoomIntel, type RoomIntel } from "./roomIntel"
import { roomDynamicIntelMemory } from "./roomDynamicIntelMemory"
import { roomStaticIntelStore } from "./roomStaticIntelStore"

export const intelStore = {
  pretick,
  isReady,
  has,
  get,
  observe,
}

function has(roomName: string): boolean {
  return isReady() && roomDynamicIntelMemory.has(roomName)
}

function pretick(): void {
  roomStaticIntelStore.pretick()
}

function isReady(): boolean {
  return roomStaticIntelStore.isReady()
}

function get(roomName: string): RoomIntel | undefined {
  if (!isReady()) {
    return
  }

  const dynamicIntel = roomDynamicIntelMemory.get(roomName)

  if (dynamicIntel === undefined) {
    return
  }

  const staticIntel = roomStaticIntelStore.get(roomName)

  if (staticIntel === undefined) {
    return
  }

  return mergeRoomIntel(roomName, staticIntel, dynamicIntel)
}

function observe(room: Room): boolean {
  if (!isReady()) {
    return false
  }

  const isNew = !roomDynamicIntelMemory.has(room.name)

  roomDynamicIntelMemory.set(room.name, createRoomDynamicIntel(room))

  if (roomStaticIntelStore.get(room.name) === undefined) {
    roomStaticIntelStore.set(room.name, createRoomStaticIntel(room))
  }

  return isNew
}
