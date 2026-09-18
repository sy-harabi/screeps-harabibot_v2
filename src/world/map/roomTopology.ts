import { parseRoomName } from "./roomName"

const adjacentRoomCache = new Map<string, readonly string[]>()

export type RoomType = "highway" | "normal" | "center" | "keeper"

export function getRoomManhattanDistance(from: string, to: string): number {
  const fromCoordinate = parseRoomName(from)
  const toCoordinate = parseRoomName(to)

  return Math.abs(fromCoordinate.x - toCoordinate.x) + Math.abs(fromCoordinate.y - toCoordinate.y)
}

export function getAdjacentRooms(roomName: string): readonly string[] {
  const cached = adjacentRoomCache.get(roomName)
  if (cached) {
    return cached
  }

  const exits = Game.map.describeExits(roomName)

  if (!exits) {
    return []
  }

  const result: string[] = Object.values(exits)

  adjacentRoomCache.set(roomName, result)

  return result
}

export function getRoomType(roomName: string): RoomType {
  const { x, y } = parseRoomName(roomName)

  let xIndex = x >= 0 ? x : -x - 1
  let yIndex = y >= 0 ? y : -y - 1

  xIndex = xIndex % 10
  yIndex = yIndex % 10

  if (xIndex === 0 || yIndex === 0) {
    return "highway"
  }

  if (xIndex === 5 && yIndex === 5) {
    return "center"
  }

  if (xIndex > 3 && xIndex < 7 && yIndex > 3 && yIndex < 7) {
    return "keeper"
  }

  return "normal"
}
