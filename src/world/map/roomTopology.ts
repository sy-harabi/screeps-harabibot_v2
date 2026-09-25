import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { parseRoomName } from "./roomName"

const ROOM_STATUS_CACHE_TTL = 100

interface CachedRoomStatus {
  readonly status: string | undefined
  readonly expiresAt: number
}

const adjacentRoomCache = new Map<string, readonly string[]>()

const roomStatusCache = runtimeRegistry.createCache<string, CachedRoomStatus>("map.roomStatus", {
  cleanupInterval: ROOM_STATUS_CACHE_TTL,
  cleanup: (cache) => {
    for (const [roomName, cached] of cache) {
      if (Game.time >= cached.expiresAt) {
        cache.delete(roomName)
      }
    }
  },
})

export type RoomType = "highway" | "normal" | "center" | "keeper"

export function getRoomManhattanDistance(fromRoomName: string, toRoomName: string): number {
  const fromCoordinate = parseRoomName(fromRoomName)
  const toCoordinate = parseRoomName(toRoomName)

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

  const adjacentRooms = Object.values(exits)

  adjacentRoomCache.set(roomName, adjacentRooms)

  return adjacentRooms
}

export function getRoomsByDepth(originRoomName: string, maxDepth: number): readonly (readonly string[])[] {
  const depthByRoom = new Map<string, number>()
  const roomsByDepth: string[][] = Array.from({ length: maxDepth + 1 }, () => [])
  const queue = [originRoomName]
  let index = 0

  depthByRoom.set(originRoomName, 0)

  while (index < queue.length) {
    const current = queue[index]
    index++

    const depth = depthByRoom.get(current)!

    if (depth >= maxDepth) {
      continue
    }

    for (const adjacent of getAdjacentRooms(current)) {
      if (depthByRoom.has(adjacent)) {
        continue
      }

      if (!isRoomReachable(adjacent, originRoomName)) {
        continue
      }

      const adjacentDepth = depth + 1

      depthByRoom.set(adjacent, adjacentDepth)
      queue.push(adjacent)
      roomsByDepth[adjacentDepth].push(adjacent)
    }
  }

  return roomsByDepth
}

export function isRoomReachable(roomName: string, referenceRoomName: string): boolean {
  const roomStatus = getRoomStatus(roomName)

  if (roomStatus === undefined || roomStatus === "closed") {
    return false
  }

  const referenceStatus = getRoomStatus(referenceRoomName) ?? "normal"

  return roomStatus === referenceStatus
}

function getRoomStatus(roomName: string): string | undefined {
  const cached = roomStatusCache.get(roomName)

  if (cached !== undefined && Game.time < cached.expiresAt) {
    return cached.status
  }

  const status = Game.map.getRoomStatus(roomName)?.status

  roomStatusCache.set(roomName, {
    status,
    expiresAt: Game.time + ROOM_STATUS_CACHE_TTL,
  })

  return status
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
