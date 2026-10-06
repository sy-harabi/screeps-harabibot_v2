import { createRoomDynamicIntel, createRoomStaticIntel, mergeRoomIntel, type RoomIntel } from "./roomIntel"
import { roomDynamicIntelMemory } from "./roomDynamicIntelMemory"
import { roomStaticIntelStore } from "./roomStaticIntelStore"
import { creepIntelStore } from "./creepIntelStore"

export const intelStore = {
  pretick,
  isReady,
  has,
  get,
  observe,
}

let mergedIntelTick = -1
const mergedIntelByRoom = new Map<string, RoomIntel | undefined>()

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

  prepareMergedIntelCache()

  if (mergedIntelByRoom.has(roomName)) {
    return mergedIntelByRoom.get(roomName)
  }

  const dynamicIntel = roomDynamicIntelMemory.get(roomName)
  const staticIntel = roomStaticIntelStore.get(roomName)
  const intel =
    dynamicIntel === undefined || staticIntel === undefined
      ? undefined
      : mergeRoomIntel(roomName, staticIntel, dynamicIntel)

  mergedIntelByRoom.set(roomName, intel)

  return intel
}

function observe(room: Room): boolean {
  if (!isReady()) {
    return false
  }

  roomDynamicIntelMemory.set(room.name, createRoomDynamicIntel(room))
  creepIntelStore.observe(room)

  prepareMergedIntelCache()
  mergedIntelByRoom.delete(room.name)

  if (roomStaticIntelStore.get(room.name) !== undefined) {
    return false
  }

  roomStaticIntelStore.set(room.name, createRoomStaticIntel(room))

  return true
}

function prepareMergedIntelCache(): void {
  if (mergedIntelTick === Game.time) {
    return
  }

  mergedIntelTick = Game.time
  mergedIntelByRoom.clear()
}
