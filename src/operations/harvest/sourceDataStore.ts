import { segmentManager } from "../../persistence/segmentManager"
import { RoomCoordinate } from "../../world/map/roomCoordinate"

interface SourceData {
  sourceId: Id<Source>
  roomName: string
  coordinate: RoomCoordinate
  colonyRoomName: string
  path: PackedPath
}

export type SourceDataDeleteResult = "loading" | "deleted"

export type SourceDataReadResult =
  { status: "loading" } | { status: "missing" } | { status: "ready"; value: SourceData }

export const sourceDataStore = {
  get,
  set,
  deleteData,
}

function get(sourceId: string): SourceDataReadResult {
  const segmentId = getSourceDataSegmentId(sourceId)

  const segmentResult = segmentManager.getSegment<Record<string, SourceData>>(segmentId)

  if (segmentResult.status === "loading") {
    return { status: "loading" }
  }

  const sourceData = segmentResult.value[sourceId]

  if (sourceData === undefined) {
    return { status: "missing" }
  }

  return { status: "ready", value: sourceData }
}

function set(sourceData: SourceData) {
  const sourceId = sourceData.sourceId

  const segmentId = getSourceDataSegmentId(sourceData.sourceId)

  const result = segmentManager.getSegment<Record<string, SourceData>>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save source data before segment ${segmentId} is loaded`)
  }

  const segment = (result.value ??= {})

  segment[sourceId] = sourceData

  segmentManager.setSegment(segmentId, segment)
}

function deleteData(sourceId: string): SourceDataDeleteResult {
  const segmentId = getSourceDataSegmentId(sourceId)

  const segmentResult = segmentManager.getSegment<Record<string, SourceData>>(segmentId)

  if (segmentResult.status === "loading") {
    return "loading"
  }

  const sourceData = segmentResult.value[sourceId]

  if (sourceData === undefined) {
    return "deleted"
  }

  const segment = segmentResult.value

  if (segment === undefined) {
    return "deleted"
  }

  delete segment[sourceId]

  segmentManager.setSegment(segmentId, segment)

  return "deleted"
}

function getSourceDataSegmentId(sourceId: string): number {}
