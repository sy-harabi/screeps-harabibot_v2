import { PackedPath, packPath, unpackPath } from "../../capabilities/movement/packedPath"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"

export interface SourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly coordinate: RoomCoordinate
  readonly colonyRoomName: string
  readonly path: readonly RoomPosition[]
}

export type PackedSourceData = readonly [
  sourceId: Id<Source>,
  roomName: string,
  coordinate: number,
  colonyRoomName: string,
  path: PackedPath,
]

export function packSourceData(sourceData: SourceData): PackedSourceData {
  return [
    sourceData.sourceId,
    sourceData.roomName,
    toRoomIndex(sourceData.coordinate.x, sourceData.coordinate.y),
    sourceData.colonyRoomName,
    packPath(sourceData.path),
  ]
}

export function unpackSourceData(packed: PackedSourceData): SourceData {
  return {
    sourceId: packed[0],
    roomName: packed[1],
    coordinate: fromRoomIndex(packed[2]),
    colonyRoomName: packed[3],
    path: unpackPath(packed[4]),
  }
}
