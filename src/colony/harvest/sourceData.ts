import { packPath, type PackedPath } from "../../capabilities/movement/packedPath"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange, toRoomIndex } from "../../world/map/roomGrid"

export interface SourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly coordinate: RoomCoordinate
  readonly colonyName: string
  readonly path: readonly RoomPosition[]
  readonly miningPositions: readonly RoomPosition[]
}

export type PackedSourceData = readonly [
  sourceId: Id<Source>,
  roomName: string,
  coordinate: number,
  colonyName: string,
  path: PackedPath,
]

export function packSourceData(sourceData: SourceData): PackedSourceData {
  return [
    sourceData.sourceId,
    sourceData.roomName,
    toRoomIndex(sourceData.coordinate.x, sourceData.coordinate.y),
    sourceData.colonyName,
    packPath(sourceData.path),
  ]
}

export function createSourceData(
  sourceId: Id<Source>,
  roomName: string,
  coordinate: RoomCoordinate,
  colonyName: string,
  path: readonly RoomPosition[],
): SourceData {
  return {
    sourceId,
    roomName,
    coordinate,
    colonyName,
    path,
    miningPositions: getMiningPositions(roomName, coordinate, path),
  }
}

export function getSourceContainer(data: SourceData): StructureContainer | undefined {
  const pos = data.path[data.path.length - 1]

  if (!pos || !Game.rooms[pos.roomName]) {
    return
  }

  return pos
    .lookFor(LOOK_STRUCTURES)
    .find((structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER)
}

function getMiningPositions(
  roomName: string,
  coordinate: RoomCoordinate,
  path: readonly RoomPosition[],
): RoomPosition[] {
  const containerPos = path[path.length - 1]
  const miningPositions = [containerPos]
  const terrain = Game.map.getRoomTerrain(roomName)

  forEachCoordinateAtRange(coordinate, 1, (x, y) => {
    if (containerPos.x === x && containerPos.y === y) {
      return
    }

    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      return
    }

    miningPositions.push(new RoomPosition(x, y, roomName))
  })

  return miningPositions
}
