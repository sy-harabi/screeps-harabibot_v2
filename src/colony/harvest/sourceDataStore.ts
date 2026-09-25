import { HARVEST_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { getHarvestDataSegmentId, normalizeHarvestDataSegment, type HarvestDataSegment } from "./harvestDataSegment"
import { packSourceData, unpackSourceData, type SourceData } from "./sourceData"

export type SourceDataDeleteResult = "loading" | "deleted"

export type SourceDataReadResult =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; value: SourceData }

const sourceDataById = runtimeRegistry.createCache<Id<Source>, SourceData>("sourceData")
const sourceDataByRoom = new Map<string, Map<Id<Source>, SourceData>>()
const EMPTY_SOURCE_MAP = new Map<Id<Source>, SourceData>()

export const sourceDataStore = {
  pretick,
  isReady,
  get,
  getByRoom,
  set,
  delete: deleteSourceData,
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

  sourceDataById.clear()
  sourceDataByRoom.clear()

  for (const segment of segments) {
    for (const packed of Object.values(segment.sources)) {
      const sourceData = unpackSourceData(packed)

      sourceDataById.set(sourceData.sourceId, sourceData)
      addToRoomIndex(sourceData)
    }
  }

  ready = true
}

function isReady(): boolean {
  return ready
}

function get(sourceId: Id<Source>): SourceDataReadResult {
  const sourceData = sourceDataById.get(sourceId)

  if (sourceData !== undefined) {
    return { status: "ready", value: sourceData }
  }

  const segmentId = getHarvestDataSegmentId(sourceId)
  const segmentResult = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (segmentResult.status === "loading") {
    return { status: "loading" }
  }

  const packed = normalizeHarvestDataSegment(segmentResult.value).sources[sourceId]

  if (packed === undefined) {
    return { status: "missing" }
  }

  const unpacked = unpackSourceData(packed)

  sourceDataById.set(sourceId, unpacked)
  addToRoomIndex(unpacked)

  return { status: "ready", value: unpacked }
}

function getByRoom(roomName: string): ReadonlyMap<Id<Source>, SourceData> {
  return sourceDataByRoom.get(roomName) ?? EMPTY_SOURCE_MAP
}

function set(sourceData: SourceData): void {
  const segmentId = getHarvestDataSegmentId(sourceData.sourceId)
  const result = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save source data before segment ${segmentId} is loaded`)
  }

  const segment = normalizeHarvestDataSegment(result.value)
  const previousPacked = segment.sources[sourceData.sourceId]
  const previous =
    sourceDataById.get(sourceData.sourceId) ??
    (previousPacked === undefined ? undefined : unpackSourceData(previousPacked))

  if (previous !== undefined && previous.roomName !== sourceData.roomName) {
    removeFromRoomIndex(previous)
  }

  segment.sources[sourceData.sourceId] = packSourceData(sourceData)

  segmentManager.setSegment(segmentId, segment)
  sourceDataById.set(sourceData.sourceId, sourceData)
  addToRoomIndex(sourceData)
}

function deleteSourceData(sourceId: Id<Source>): SourceDataDeleteResult {
  const segmentId = getHarvestDataSegmentId(sourceId)
  const segmentResult = segmentManager.getSegment<Partial<HarvestDataSegment>>(segmentId)

  if (segmentResult.status === "loading") {
    return "loading"
  }

  const segment = normalizeHarvestDataSegment(segmentResult.value)
  const packed = segment.sources[sourceId]
  const sourceData = sourceDataById.get(sourceId) ?? (packed === undefined ? undefined : unpackSourceData(packed))

  if (sourceData !== undefined) {
    removeFromRoomIndex(sourceData)
  }

  sourceDataById.delete(sourceId)

  if (packed === undefined) {
    return "deleted"
  }

  delete segment.sources[sourceId]
  segmentManager.setSegment(segmentId, segment)

  return "deleted"
}

function addToRoomIndex(sourceData: SourceData): void {
  let sources = sourceDataByRoom.get(sourceData.roomName)

  if (sources === undefined) {
    sources = new Map()
    sourceDataByRoom.set(sourceData.roomName, sources)
  }

  sources.set(sourceData.sourceId, sourceData)
}

function removeFromRoomIndex(sourceData: SourceData): void {
  const sources = sourceDataByRoom.get(sourceData.roomName)

  if (sources === undefined) {
    return
  }

  sources.delete(sourceData.sourceId)

  if (sources.size === 0) {
    sourceDataByRoom.delete(sourceData.roomName)
  }
}
