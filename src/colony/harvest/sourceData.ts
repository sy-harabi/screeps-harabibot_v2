import { packPath, unpackPath, type PackedPath } from "../../capabilities/movement/packedPath"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { forEachCoordinateAtRange, fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"

export interface SourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly miningPositions: readonly RoomPosition[]
  readonly ownedPath?: readonly RoomPosition[]
}

export interface HarvestSourceData {
  readonly sourceId: Id<Source>
  readonly roomName: string
  readonly colonyName: string
  readonly path: readonly RoomPosition[]
  readonly miningPositions: readonly RoomPosition[]
}

export type PackedSourceData = readonly [
  sourceId: Id<Source>,
  roomName: string,
  miningPositions: readonly number[],
  ownedPath?: PackedPath | null,
]

export function createSourceData(
  sourceId: Id<Source>,
  roomName: string,
  coordinate: RoomCoordinate,
  ownedPath?: readonly RoomPosition[],
): SourceData {
  return {
    sourceId,
    roomName,
    miningPositions: getMiningPositions(roomName, coordinate),
    ownedPath,
  }
}

export function withOwnedPath(sourceData: SourceData, ownedPath: readonly RoomPosition[]): SourceData {
  return {
    ...sourceData,
    ownedPath,
  }
}

export function createHarvestSourceData(
  sourceData: SourceData,
  colonyName: string,
  path: readonly RoomPosition[],
): HarvestSourceData {
  return {
    sourceId: sourceData.sourceId,
    roomName: sourceData.roomName,
    colonyName,
    path,
    miningPositions: sourceData.miningPositions,
  }
}

export function packSourceData(sourceData: SourceData): PackedSourceData {
  const packed = [
    sourceData.sourceId,
    sourceData.roomName,
    sourceData.miningPositions.map((pos) => toRoomIndex(pos.x, pos.y)),
  ] as const

  return sourceData.ownedPath === undefined ? packed : [...packed, packPath(sourceData.ownedPath)]
}

export function unpackSourceData(packed: PackedSourceData): SourceData {
  const roomName = packed[1]

  return {
    sourceId: packed[0],
    roomName,
    miningPositions: packed[2].map((index) => {
      const coordinate = fromRoomIndex(index)
      return new RoomPosition(coordinate.x, coordinate.y, roomName)
    }),
    ownedPath: packed[3] == null ? undefined : unpackPath(packed[3]),
  }
}

export function getSourceContainer(data: HarvestSourceData): StructureContainer | undefined {
  const pos = data.path[data.path.length - 1]

  if (!pos || !Game.rooms[pos.roomName]) {
    return
  }

  return pos
    .lookFor(LOOK_STRUCTURES)
    .find((structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER)
}

function getMiningPositions(roomName: string, coordinate: RoomCoordinate): RoomPosition[] {
  const terrain = Game.map.getRoomTerrain(roomName)
  const result: RoomPosition[] = []

  forEachCoordinateAtRange(coordinate, 1, (x, y) => {
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
      return
    }

    result.push(new RoomPosition(x, y, roomName))
  })

  return result
}
