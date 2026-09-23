import { ROOM_INTEL_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { RoomStaticIntel } from "./roomIntel"
import {
  packRoomStaticIntel,
  unpackRoomStaticIntel,
  type PackedRoomStaticIntel,
} from "./roomStaticIntelCodec"

interface RoomStaticIntelSegment {
  version: 1
  mineralTypes: MineralConstant[]
  rooms: Record<string, PackedRoomStaticIntel>
}

const cache = runtimeRegistry.createCache<string, RoomStaticIntel>("roomStaticIntel")

let ready = false

export const roomStaticIntelStore = {
  pretick,
  isReady,
  get,
  set,
}

function pretick(): void {
  if (ready) {
    return
  }

  let allReady = true

  for (const segmentId of ROOM_INTEL_SEGMENT_IDS) {
    const result = segmentManager.getSegment<RoomStaticIntelSegment>(segmentId)

    if (result.status === "loading") {
      allReady = false
    }
  }

  ready = allReady
}

function isReady(): boolean {
  return ready
}

function get(roomName: string): RoomStaticIntel | undefined {
  if (!ready) {
    return
  }

  const cached = cache.get(roomName)

  if (cached !== undefined) {
    return cached
  }

  const segmentId = getSegmentId(roomName)
  const segment = getLoadedSegment(segmentId)
  const packed = segment.rooms[roomName]

  if (packed === undefined) {
    return
  }

  const intel = unpackRoomStaticIntel(packed, segment.mineralTypes)

  cache.set(roomName, intel)

  return intel
}

function set(roomName: string, intel: RoomStaticIntel): void {
  if (!ready) {
    throw new Error("Cannot write room static intel before store is ready")
  }

  const segmentId = getSegmentId(roomName)
  const segment = getLoadedSegment(segmentId)

  segment.rooms[roomName] = packRoomStaticIntel(intel, (type) => getMineralTypeIndex(segment, type))

  segmentManager.setSegment(segmentId, segment)
  cache.set(roomName, intel)
}

function getLoadedSegment(segmentId: number): RoomStaticIntelSegment {
  const result = segmentManager.getSegment<Partial<RoomStaticIntelSegment>>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Room static intel segment ${segmentId} became unavailable after store was ready`)
  }

  return normalizeSegment(segmentId, result.value)
}

function normalizeSegment(
  segmentId: number,
  value: Partial<RoomStaticIntelSegment>,
): RoomStaticIntelSegment {
  if (value.version === undefined) {
    return {
      version: 1,
      mineralTypes: [],
      rooms: {},
    }
  }

  if (
    value.version !== 1 ||
    !Array.isArray(value.mineralTypes) ||
    value.rooms === undefined ||
    value.rooms === null ||
    typeof value.rooms !== "object"
  ) {
    throw new Error(`Invalid room static intel segment ${segmentId}`)
  }

  return value as RoomStaticIntelSegment
}

function getMineralTypeIndex(segment: RoomStaticIntelSegment, type: MineralConstant): number {
  let index = segment.mineralTypes.indexOf(type)

  if (index !== -1) {
    return index
  }

  index = segment.mineralTypes.length
  segment.mineralTypes.push(type)

  return index
}

function getSegmentId(roomName: string): number {
  let hash = 0

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0
  }

  return ROOM_INTEL_SEGMENT_IDS[hash % ROOM_INTEL_SEGMENT_IDS.length]
}
