import { createRoomDynamicIntel, createRoomStaticIntel, mergeRoomIntel, type RoomIntel } from "./roomIntel"
import { roomDynamicIntelMemory } from "./roomDynamicIntelMemory"
import { roomStaticIntelStore } from "./roomStaticIntelStore"

export interface RoomObservationResult {
  readonly isNew: boolean
  readonly ownerChanged: boolean
  readonly becameOwned: boolean
}

const NOT_OBSERVED: RoomObservationResult = {
  isNew: false,
  ownerChanged: false,
  becameOwned: false,
}

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

function observe(room: Room): RoomObservationResult {
  if (!isReady()) {
    return NOT_OBSERVED
  }

  const staticIntel = roomStaticIntelStore.get(room.name)
  const previousDynamicIntel = roomDynamicIntelMemory.get(room.name)
  const dynamicIntel = createRoomDynamicIntel(room)
  const isNew = staticIntel === undefined
  const previousOwner = previousDynamicIntel?.controller?.owner?.username
  const owner = dynamicIntel.controller?.owner?.username
  const ownerChanged = previousOwner !== owner
  const becameOwned = room.controller?.my === true && ownerChanged

  roomDynamicIntelMemory.set(room.name, dynamicIntel)

  if (staticIntel === undefined) {
    roomStaticIntelStore.set(room.name, createRoomStaticIntel(room))
  }

  return {
    isNew,
    ownerChanged,
    becameOwned,
  }
}
