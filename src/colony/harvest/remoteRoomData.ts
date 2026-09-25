import { packPath, unpackPath, type PackedPath } from "../../capabilities/movement/packedPath"

export interface RemoteSourceData {
  readonly sourceId: Id<Source>
  readonly path: readonly RoomPosition[]
}

export interface RemoteRoomData {
  readonly roomName: string
  readonly colonyName: string
  readonly sources: readonly RemoteSourceData[]
  readonly intermediateRoomNames: readonly string[]
}

export type PackedRemoteRoomData = readonly [
  colonyName: string,
  sources: readonly (readonly [sourceId: Id<Source>, path: PackedPath])[],
]

export function createRemoteRoomData(
  roomName: string,
  colonyName: string,
  sources: readonly RemoteSourceData[],
): RemoteRoomData {
  const intermediateRoomNames = new Set<string>()

  for (const source of sources) {
    for (const pos of source.path) {
      if (pos.roomName !== colonyName && pos.roomName !== roomName) {
        intermediateRoomNames.add(pos.roomName)
      }
    }
  }

  return {
    roomName,
    colonyName,
    sources,
    intermediateRoomNames: [...intermediateRoomNames],
  }
}

export function packRemoteRoomData(data: RemoteRoomData): PackedRemoteRoomData {
  return [data.colonyName, data.sources.map((source) => [source.sourceId, packPath(source.path)] as const)]
}

export function unpackRemoteRoomData(roomName: string, packed: PackedRemoteRoomData): RemoteRoomData {
  return createRemoteRoomData(
    roomName,
    packed[0],
    packed[1].map(([sourceId, path]) => ({
      sourceId,
      path: unpackPath(path),
    })),
  )
}

export function getRemoteTotalDistance(data: RemoteRoomData): number {
  let distance = 0

  for (const source of data.sources) {
    distance += source.path.length
  }

  return distance
}
