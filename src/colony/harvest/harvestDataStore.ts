import { HARVEST_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import {
  packHarvestRoomData,
  unpackHarvestRoomData,
  type HarvestRoomData,
  type PackedHarvestRoomData,
} from "./harvestRoomData"

interface HarvestDataSegment {
  version: 1
  rooms: Record<string, PackedHarvestRoomData>
}

const EMPTY_ROOM_NAMES: ReadonlySet<string> = new Set()

export const harvestRoomDataStore = {
  pretick,
  isReady,
  get,
  set,
  delete: deleteHarvestData,
  getByColony,
}

const dataByRoom = runtimeRegistry.createCache<string, HarvestRoomData>("harvest.rooms")
const roomsByColony = new Map<string, Set<string>>()

let ready = false

function pretick(): boolean {
  if (ready) {
    return true
  }

  const segments: HarvestDataSegment[] = []
  ready = true

  for (const segmentId of HARVEST_DATA_SEGMENT_IDS) {
    const result = segmentManager.getSegment<HarvestDataSegment>(segmentId)

    if (result.status === "loading") {
      ready = false
      continue
    }

    if (result.value.version === 1 && result.value.rooms) {
      segments.push(result.value)
    }
  }

  if (!ready) {
    return false
  }

  dataByRoom.clear()
  roomsByColony.clear()

  for (const segment of segments) {
    for (const [roomName, packed] of Object.entries(segment.rooms)) {
      const data = unpackHarvestRoomData(packed)

      dataByRoom.set(roomName, data)
      addToColonyIndex(roomName, data.colonyName)
    }
  }

  return true
}

function isReady(): boolean {
  return ready
}

function deleteHarvestData(roomName: string): void {
  const segmentId = getHarvestDataSegmentId(roomName)
  const result = segmentManager.getSegment<HarvestDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error("Cannot delete harvest data before segment " + segmentId + " is loaded")
  }

  const segment =
    result.value.version === 1 && result.value.rooms
      ? result.value
      : {
          version: 1 as const,
          rooms: {},
        }

  delete segment.rooms[roomName]
  segmentManager.setSegment(segmentId, segment)

  const data = dataByRoom.get(roomName)

  if (data !== undefined) {
    removeFromColonyIndex(roomName, data.colonyName)
    dataByRoom.delete(roomName)
  }
}

function getByColony(colonyName: string): ReadonlySet<string> {
  if (!ready) {
    throw new Error("Cannot read harvest rooms before ready")
  }

  return roomsByColony.get(colonyName) ?? EMPTY_ROOM_NAMES
}

function get(roomName: string): HarvestRoomData | undefined {
  if (!ready) {
    throw new Error("Cannot read harvest data before ready")
  }

  return dataByRoom.get(roomName)
}

function set(roomName: string, data: HarvestRoomData): void {
  const previous = dataByRoom.get(roomName)

  if (previous !== undefined && previous.colonyName !== data.colonyName) {
    removeFromColonyIndex(roomName, previous.colonyName)
  }

  const segmentId = getHarvestDataSegmentId(roomName)
  const result = segmentManager.getSegment<HarvestDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error("Cannot save harvest data before segment " + segmentId + " is loaded")
  }

  const segment =
    result.value.version === 1 && result.value.rooms
      ? result.value
      : {
          version: 1 as const,
          rooms: {},
        }

  segment.rooms[roomName] = packHarvestRoomData(data)
  segmentManager.setSegment(segmentId, segment)
  dataByRoom.set(roomName, data)
  addToColonyIndex(roomName, data.colonyName)
}

function addToColonyIndex(roomName: string, colonyName: string): void {
  const rooms = roomsByColony.get(colonyName)

  if (rooms === undefined) {
    roomsByColony.set(colonyName, new Set([roomName]))
    return
  }

  rooms.add(roomName)
}

function removeFromColonyIndex(roomName: string, colonyName: string): void {
  const rooms = roomsByColony.get(colonyName)

  if (rooms === undefined) {
    return
  }

  rooms.delete(roomName)

  if (rooms.size === 0) {
    roomsByColony.delete(colonyName)
  }
}

function getHarvestDataSegmentId(roomName: string): number {
  let hash = 0

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0
  }

  return HARVEST_DATA_SEGMENT_IDS[hash % HARVEST_DATA_SEGMENT_IDS.length]
}
