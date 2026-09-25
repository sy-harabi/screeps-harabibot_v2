import { unpackPath } from "../../capabilities/movement/packedPath"
import { SOURCE_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { fromRoomIndex } from "../../world/map/roomGrid"
import { createSourceData, packSourceData, type PackedSourceData, type SourceData } from "./sourceData"

interface SourceDataSegment {
  version: 1
  sources: Record<string, PackedSourceData>
}

export type SourceDataDeleteResult = "loading" | "deleted"

export type SourceDataReadResult =
  { status: "loading" } | { status: "missing" } | { status: "ready"; value: SourceData }

const sourceDataById = runtimeRegistry.createCache<Id<Source>, SourceData>("sourceData")
const sourceDataByColony = new Map<string, Map<Id<Source>, SourceData>>()
const EMPTY_SOURCE_MAP = new Map<Id<Source>, SourceData>()

export const sourceDataStore = {
  pretick,
  isReady,
  get,
  getByColony,
  set,
  delete: deleteSourceData,
}

let ready = false

function pretick(): void {
  if (ready) {
    return
  }

  const segments: SourceDataSegment[] = []
  let allReady = true

  for (const segmentId of SOURCE_DATA_SEGMENT_IDS) {
    const result = segmentManager.getSegment<SourceDataSegment>(segmentId)

    if (result.status === "loading") {
      allReady = false
      continue
    }

    segments.push(result.value)
  }

  if (!allReady) {
    return
  }

  sourceDataByColony.clear()

  for (const segment of segments) {
    for (const packed of Object.values(getPackedSourceDataMap(segment))) {
      const sourceData = unpackSourceData(packed)

      sourceDataById.set(sourceData.sourceId, sourceData)
      addToColonyIndex(sourceData)
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

  const segmentId = getSourceDataSegmentId(sourceId)
  const segmentResult = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return { status: "loading" }
  }

  const packed = getPackedSourceDataMap(segmentResult.value)[sourceId]

  if (packed === undefined) {
    return { status: "missing" }
  }

  const unpacked = unpackSourceData(packed)

  sourceDataById.set(sourceId, unpacked)

  return { status: "ready", value: unpacked }
}

function getByColony(colonyName: string): ReadonlyMap<Id<Source>, SourceData> {
  return sourceDataByColony.get(colonyName) ?? EMPTY_SOURCE_MAP
}

function set(sourceData: SourceData): void {
  const segmentId = getSourceDataSegmentId(sourceData.sourceId)
  const result = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save source data before segment ${segmentId} is loaded`)
  }

  const sources = getPackedSourceDataMap(result.value)
  const previousPacked = sources[sourceData.sourceId]
  const previous =
    sourceDataById.get(sourceData.sourceId) ??
    (previousPacked === undefined ? undefined : unpackSourceData(previousPacked))

  if (previous !== undefined && previous.colonyName !== sourceData.colonyName) {
    removeFromColonyIndex(previous)
  }

  sources[sourceData.sourceId] = packSourceData(sourceData)

  segmentManager.setSegment(segmentId, {
    version: 1,
    sources,
  })

  sourceDataById.set(sourceData.sourceId, sourceData)
  addToColonyIndex(sourceData)
}

function deleteSourceData(sourceId: Id<Source>): SourceDataDeleteResult {
  const segmentId = getSourceDataSegmentId(sourceId)
  const segmentResult = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return "loading"
  }

  const sources = getPackedSourceDataMap(segmentResult.value)
  const packed = sources[sourceId]
  const sourceData = sourceDataById.get(sourceId) ?? (packed === undefined ? undefined : unpackSourceData(packed))

  if (sourceData !== undefined) {
    removeFromColonyIndex(sourceData)
  }

  sourceDataById.delete(sourceId)

  if (packed === undefined) {
    return "deleted"
  }

  delete sources[sourceId]

  segmentManager.setSegment(segmentId, {
    version: 1,
    sources,
  })

  return "deleted"
}

function addToColonyIndex(sourceData: SourceData): void {
  let sources = sourceDataByColony.get(sourceData.colonyName)

  if (sources === undefined) {
    sources = new Map()
    sourceDataByColony.set(sourceData.colonyName, sources)
  }

  sources.set(sourceData.sourceId, sourceData)
}

function removeFromColonyIndex(sourceData: SourceData): void {
  const sources = sourceDataByColony.get(sourceData.colonyName)

  if (sources === undefined) {
    return
  }

  sources.delete(sourceData.sourceId)

  if (sources.size === 0) {
    sourceDataByColony.delete(sourceData.colonyName)
  }
}

function unpackSourceData(packed: PackedSourceData): SourceData {
  return createSourceData(packed[0], packed[1], fromRoomIndex(packed[2]), packed[3], unpackPath(packed[4]))
}

function getPackedSourceDataMap(segment: Partial<SourceDataSegment>): Record<string, PackedSourceData> {
  return segment.version === 1 && segment.sources ? segment.sources : {}
}

function getSourceDataSegmentId(sourceId: Id<Source>): number {
  let hash = 0

  for (let i = 0; i < sourceId.length; i++) {
    hash = (hash * 31 + sourceId.charCodeAt(i)) >>> 0
  }

  return SOURCE_DATA_SEGMENT_IDS[hash % SOURCE_DATA_SEGMENT_IDS.length]
}
