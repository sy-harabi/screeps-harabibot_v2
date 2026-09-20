import { PackedPath, packPath, unpackPath } from "../../capabilities/movement/packedPath"
import { RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange, fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"

export interface SourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly coordinate: RoomCoordinate
  readonly colonyRoomName: string
  readonly path: readonly RoomPosition[]
  readonly miningPositions: readonly RoomPosition[]
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
  const roomName = packed[1]
  const coordinate = fromRoomIndex(packed[2])
  const path = unpackPath(packed[4])
  const containerPos = path[path.length - 1]

  const sourcePosition = new RoomPosition(coordinate.x, coordinate.y, roomName)
  const miningPositions = [containerPos]

  const terrain = Game.map.getRoomTerrain(roomName)

  forEachCoordinateAtRange(sourcePosition, 1, (x, y) => {
    if (containerPos.x === x && containerPos.y === y) {
      return
    }

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      return
    }

    miningPositions.push(new RoomPosition(x, y, roomName))
  })

  return {
    sourceId: packed[0],
    roomName,
    coordinate,
    colonyRoomName: packed[3],
    path,
    miningPositions,
  }
}

export function createSourceData(
  sourceId: Id<Source>,
  roomName: string,
  coordinate: RoomCoordinate,
  colonyRoomName: string,
  path: readonly RoomPosition[],
): SourceData {
  return {
    sourceId,
    roomName,
    coordinate,
    colonyRoomName,
    path,
    miningPositions: getMiningPositions(roomName, coordinate, path),
  }
}
