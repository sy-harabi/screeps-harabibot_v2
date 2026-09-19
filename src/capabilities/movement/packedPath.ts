import { Codec } from "../../vendor/utf15"

const pathCodec = new Codec({ depth: 6, array: true })

export function compressPath(path: RoomPosition[]) {
  if (path.length === 0) {
    return [[]]
  }

  let currentRoomName = path[0].roomName

  const result = [currentRoomName]

  let currentArray: number[] = []

  for (const pos of path) {
    if (pos.roomName !== currentRoomName) {
      result.push(pathCodec.encode(currentArray))

      currentRoomName = pos.roomName
      result.push(currentRoomName)

      currentArray = []
    }

    currentArray.push(pos.x, pos.y)
  }

  result.push(pathCodec.encode(currentArray))

  return result
}

export function unpackPath(packedPath: string[]): RoomPosition[] {
  const result: RoomPosition[] = []
  if (packedPath.length === 0) {
    return result
  }

  let currentRoomName = packedPath[0]

  for (let i = 1; i < packedPath.length; i++) {
    if (i % 2 === 0) {
      currentRoomName = packedPath[i]
    } else {
      const coords = pathCodec.decode(packedPath[i])

      if (Array.isArray(coords)) {
        for (let i = 0; i < coords.length; i += 2) {
          const x = coords[i]
          const y = coords[i + 1]
          const pos = new RoomPosition(x, y, currentRoomName)
          result.push(pos)
        }
      }
    }
  }

  return result
}
