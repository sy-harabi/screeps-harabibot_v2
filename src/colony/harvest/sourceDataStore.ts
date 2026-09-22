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

const sourceDataCache = runtimeRegistry.createCache<Id<Source>, SourceData>("sourceData")

export const sourceDataStore = {
  get,
  set,
  delete: deleteSourceData,
}

function get(sourceId: Id<Source>): SourceDataReadResult {
  const cached = sourceDataCache.get(sourceId)

  if (cached !== undefined) {
    return { status: "ready", value: cached }
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

  const sourceData = createSourceData(packed[0], packed[1], fromRoomIndex(packed[2]), packed[3], unpackPath(packed[4]))

  sourceDataCache.set(sourceId, sourceData)

  return { status: "ready", value: sourceData }
}

function set(sourceData: SourceData): void {
  const segmentId = getSourceDataSegmentId(sourceData.sourceId)

  const result = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save source data before segment ${segmentId} is loaded`)
  }

  const segment =
    result.value.version === 1 && result.value.sources
      ? result.value
      : {
          version: 1 as const,
          sources: {},
        }

  segment.sources[sourceData.sourceId] = packSourceData(sourceData)
  segmentManager.setSegment(segmentId, segment)
  sourceDataCache.set(sourceData.sourceId, sourceData)
}

function deleteSourceData(sourceId: Id<Source>): SourceDataDeleteResult {
  const segmentId = getSourceDataSegmentId(sourceId)

  const segmentResult = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return "loading"
  }

  const sources = getPackedSourceDataMap(segmentResult.value)
  sourceDataCache.delete(sourceId)

  if (sources[sourceId] === undefined) {
    return "deleted"
  }

  delete sources[sourceId]

  segmentManager.setSegment(segmentId, {
    version: 1,
    sources,
  })

  return "deleted"
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
