import {
  createRoomDynamicIntel,
  createRoomStaticIntel,
  mergeRoomIntel,
  type RoomIntel,
} from "./roomIntel"
import { roomDynamicIntelMemory } from "./roomDynamicIntelMemory"
import { roomStaticIntelStore } from "./roomStaticIntelStore"

export const intelStore = {
  pretick,
  isReady,
  get,
  observe,
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

function observe(room: Room): void {
  if (!isReady()) {
    return
  }

  roomDynamicIntelMemory.set(room.name, createRoomDynamicIntel(room))

  if (roomStaticIntelStore.get(room.name) === undefined) {
    roomStaticIntelStore.set(room.name, createRoomStaticIntel(room))
  }
}
