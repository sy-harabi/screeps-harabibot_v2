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

export const harvsetRoomDataStore = {
  pretick,
  isReady,
  get,
  set,
  delete: deleteHarvestData,
  getRemoteNames,
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

    segments.push(result.value)
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

function isReady() {
  return ready === true
}

function deleteHarvestData(roomName: string): void {
  const segmentId = getHarvestDataSegmentId(roomName)

  const result = segmentManager.getSegment<HarvestDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot delete harvest data before segment ${segmentId} is loaded`)
  }

  const segment =
    result.value.version === 1
      ? result.value
      : {
          version: 1 as const,
          rooms: {},
        }

  delete segment.rooms[roomName]
  segmentManager.setSegment(segmentId, segment)

  const data = dataByRoom.get(roomName)

  if (data) {
    removeFromColonyIndex(roomName, data.colonyName)
    dataByRoom.delete(roomName)
  }
}

function getRemoteNames(colonyName: string): Set<string> | undefined {
  if (!isReady()) {
    throw new Error(`Cannot read remote names before ready`)
  }

  return roomsByColony.get(colonyName)
}

function get(roomName: string): HarvestRoomData | undefined {
  if (!isReady()) {
    throw new Error(`Cannot read harvest data before ready`)
  }

  return dataByRoom.get(roomName)
}

function set(roomName: string, data: HarvestRoomData): void {
  const previous = dataByRoom.get(roomName)

  if (previous !== undefined && previous.colonyName !== data.colonyName) {
    deleteHarvestData(roomName)
  }

  const segmentId = getHarvestDataSegmentId(roomName)

  const result = segmentManager.getSegment<HarvestDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save harvest data before segment ${segmentId} is loaded`)
  }

  const segment =
    result.value.version === 1
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
  const colonyIndex = roomsByColony.get(colonyName)

  if (colonyIndex === undefined) {
    roomsByColony.set(colonyName, new Set<string>([roomName]))
    return
  }

  colonyIndex.add(roomName)
}

function removeFromColonyIndex(roomName: string, colonyName: string): void {
  const colonyIndex = roomsByColony.get(colonyName)
  if (colonyIndex === undefined) {
    return
  }

  colonyIndex.delete(roomName)
}

function getHarvestDataSegmentId(roomName: string): number {
  let hash = 0

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0
  }

  return HARVEST_DATA_SEGMENT_IDS[hash % HARVEST_DATA_SEGMENT_IDS.length]
}
