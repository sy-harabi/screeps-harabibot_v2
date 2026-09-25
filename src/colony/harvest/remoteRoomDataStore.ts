import { HARVEST_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { getHarvestDataSegmentId, normalizeHarvestDataSegment, type HarvestDataSegment } from "./harvestDataSegment"
import { packRemoteRoomData, unpackRemoteRoomData, type RemoteRoomData } from "./remoteRoomData"

const remoteRoomDataByName = runtimeRegistry.createCache<string, RemoteRoomData>("harvest.remoteRooms")
const remotesByColony = new Map<string, Set<string>>()
const EMPTY_REMOTE_SET = new Set<string>()

export const remoteRoomDataStore = {
  pretick,
  isReady,
  get,
  getByColony,
  set,
  delete: deleteRemoteRoomData,
}

let ready = false

function pretick(): void {
  if (ready) {
    return
  }

  const segments: HarvestDataSegment[] = []
  let allReady = true

  for (const segmentId of HARVEST_DATA_SEGMENT_IDS) {
    const result = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

    if (result.status === "loading") {
      allReady = false
      continue
    }

    segments.push(normalizeHarvestDataSegment(result.value))
  }

  if (!allReady) {
    return
  }

  remoteRoomDataByName.clear()
  remotesByColony.clear()

  for (const segment of segments) {
    for (const [roomName, packed] of Object.entries(segment.remotes)) {
      const data = unpackRemoteRoomData(roomName, packed)

      remoteRoomDataByName.set(roomName, data)
      addToColonyIndex(data)
    }
  }

  ready = true
}

function isReady(): boolean {
  return ready
}

function get(roomName: string): RemoteRoomData | undefined {
  const cached = remoteRoomDataByName.get(roomName)

  if (cached !== undefined) {
    return cached
  }

  const segmentId = getHarvestDataSegmentId(roomName)
  const result = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (result.status === "loading") {
    return
  }

  const packed = normalizeHarvestDataSegment(result.value).remotes[roomName]

  if (packed === undefined) {
    return
  }

  const data = unpackRemoteRoomData(roomName, packed)

  remoteRoomDataByName.set(roomName, data)
  addToColonyIndex(data)

  return data
}

function getByColony(colonyName: string): ReadonlySet<string> {
  return remotesByColony.get(colonyName) ?? EMPTY_REMOTE_SET
}

function set(data: RemoteRoomData): void {
  const segmentId = getHarvestDataSegmentId(data.roomName)
  const result = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save remote room data before segment ${segmentId} is loaded`)
  }

  const segment = normalizeHarvestDataSegment(result.value)
  const previousPacked = segment.remotes[data.roomName]
  const previous =
    remoteRoomDataByName.get(data.roomName) ??
    (previousPacked === undefined ? undefined : unpackRemoteRoomData(data.roomName, previousPacked))

  if (previous !== undefined && previous.colonyName !== data.colonyName) {
    removeFromColonyIndex(previous)
  }

  segment.remotes[data.roomName] = packRemoteRoomData(data)

  segmentManager.setSegment(segmentId, segment)
  remoteRoomDataByName.set(data.roomName, data)
  addToColonyIndex(data)
}

function deleteRemoteRoomData(roomName: string): void {
  const segmentId = getHarvestDataSegmentId(roomName)
  const result = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (result.status === "loading") {
    return
  }

  const segment = normalizeHarvestDataSegment(result.value)
  const packed = segment.remotes[roomName]
  const data =
    remoteRoomDataByName.get(roomName) ??
    (packed === undefined ? undefined : unpackRemoteRoomData(roomName, packed))

  if (data !== undefined) {
    removeFromColonyIndex(data)
  }

  remoteRoomDataByName.delete(roomName)

  if (packed === undefined) {
    return
  }

  delete segment.remotes[roomName]
  segmentManager.setSegment(segmentId, segment)
}

function addToColonyIndex(data: RemoteRoomData): void {
  let remoteNames = remotesByColony.get(data.colonyName)

  if (remoteNames === undefined) {
    remoteNames = new Set()
    remotesByColony.set(data.colonyName, remoteNames)
  }

  remoteNames.add(data.roomName)
}

function removeFromColonyIndex(data: RemoteRoomData): void {
  const remoteNames = remotesByColony.get(data.colonyName)

  if (remoteNames === undefined) {
    return
  }

  remoteNames.delete(data.roomName)

  if (remoteNames.size === 0) {
    remotesByColony.delete(data.colonyName)
  }
}
