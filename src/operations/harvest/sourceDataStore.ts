import { SOURCE_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import { segmentManager } from "../../persistence/segmentManager"
import { RoomCoordinate } from "../../world/map/roomCoordinate"

export interface SourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly coordinate: RoomCoordinate
  readonly colonyRoomName: string
  readonly path: PackedPath
}

interface SourceDataSegment {
  version: 1
  sources: Record<string, SourceData>
}

export type SourceDataDeleteResult = "loading" | "deleted"

export type SourceDataReadResult =
  { status: "loading" } | { status: "missing" } | { status: "ready"; value: SourceData }

export const sourceDataStore = {
  get,
  set,
  delete: deleteSourceData,
}

function get(sourceId: Id<Source>): SourceDataReadResult {
  const segmentId = getSourceDataSegmentId(sourceId)

  const segmentResult = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return { status: "loading" }
  }

  const sourceData = getSources(segmentResult.value)[sourceId]

  if (sourceData === undefined) {
    return { status: "missing" }
  }

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

  segment.sources[sourceData.sourceId] = sourceData
  segmentManager.setSegment(segmentId, segment)
}

function deleteSourceData(sourceId: Id<Source>): SourceDataDeleteResult {
  const segmentId = getSourceDataSegmentId(sourceId)

  const segmentResult = segmentManager.getSegment<SourceDataSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return "loading"
  }

  const sources = getSources(segmentResult.value)

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

function getSources(segment: Partial<SourceDataSegment>): Record<string, SourceData> {
  return segment.version === 1 && segment.sources ? segment.sources : {}
}

function getSourceDataSegmentId(sourceId: Id<Source>): number {
  let hash = 0

  for (let i = 0; i < sourceId.length; i++) {
    hash = (hash * 31 + sourceId.charCodeAt(i)) >>> 0
  }

  return SOURCE_DATA_SEGMENT_IDS[hash % SOURCE_DATA_SEGMENT_IDS.length]
}
