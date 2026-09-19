import { Codec } from "../../vendor/utf15"

const pathCodec = new Codec({ depth: 6, array: true })

export type PackedPath = readonly string[]

export function packPath(path: readonly RoomPosition[]): PackedPath {
  if (path.length === 0) {
    return []
  }

  const result: string[] = []

  let currentRoomName = path[0].roomName
  let coordinates: number[] = []

  for (const pos of path) {
    if (pos.roomName !== currentRoomName) {
      result.push(currentRoomName, pathCodec.encode(coordinates))
      currentRoomName = pos.roomName
      coordinates = []
    }

    coordinates.push(pos.x, pos.y)
  }

  result.push(currentRoomName, pathCodec.encode(coordinates))

  return result
}

export function unpackPath(packedPath: PackedPath): RoomPosition[] {
  const result: RoomPosition[] = []

  for (let i = 0; i < packedPath.length; i += 2) {
    const roomName = packedPath[i]
    const coordinates = pathCodec.decode(packedPath[i + 1])

    if (!Array.isArray(coordinates)) {
      throw new Error("Invalid packed path")
    }

    for (let j = 0; j < coordinates.length; j += 2) {
      result.push(new RoomPosition(coordinates[j], coordinates[j + 1], roomName))
    }
  }

  return result
}
