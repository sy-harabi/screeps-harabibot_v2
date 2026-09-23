import { runtimeRegistry } from "../runtime/runtimeRegistry"
import { intelStore } from "../world/intel/intelStore"
import { getAdjacentRooms, getRoomType } from "../world/map/roomTopology"

type ExploreRoomsByDepth = readonly (readonly string[])[]

const MAX_EXPLORE_DEPTH = 17

const EXPLORE_HORIZONS = [1, 3, 5, 9, 13, 17] as const

export function getExploreCandidates(colonyName: string): readonly string[] {
  if (!intelStore.isReady()) {
    return []
  }

  const exploreRoomsByDepth = getExploreRoomsByDepth(colonyName)
  const candidates: string[] = []

  let horizonIndex = 0

  for (let depth = 1; depth <= MAX_EXPLORE_DEPTH; depth++) {
    for (const roomName of exploreRoomsByDepth[depth]) {
      if (getRoomType(roomName) === "highway") {
        continue
      }

      if (intelStore.has(roomName)) {
        continue
      }

      candidates.push(roomName)
    }

    if (depth !== EXPLORE_HORIZONS[horizonIndex]) {
      continue
    }

    if (candidates.length > 0) {
      return candidates
    }

    horizonIndex++
  }

  return []
}

const exploreRoomsByColony = runtimeRegistry.createCache<string, ExploreRoomsByDepth>("scouting.exploreMaps", {
  cleanupInterval: 500,
  cleanup: (maps) => {
    for (const colonyName of maps.keys()) {
      if (Game.rooms[colonyName]?.controller?.my !== true) {
        maps.delete(colonyName)
      }
    }
  },
})

export function getExploreRoomsByDepth(colonyName: string): ExploreRoomsByDepth {
  let map = exploreRoomsByColony.get(colonyName)

  if (map === undefined) {
    map = createExploreRoomsByDepth(colonyName)
    exploreRoomsByColony.set(colonyName, map)
  }

  return map
}

function createExploreRoomsByDepth(colonyName: string): ExploreRoomsByDepth {
  const depthByRoom = new Map<string, number>()
  const roomsByDepth: string[][] = Array.from({ length: MAX_EXPLORE_DEPTH + 1 }, () => [])

  const queue = [colonyName]
  let index = 0

  depthByRoom.set(colonyName, 0)

  while (queue.length > 0) {
    const current = queue[index]
    index++
    const depth = depthByRoom.get(current)!

    if (depth >= MAX_EXPLORE_DEPTH) {
      continue
    }

    for (const adjacent of getAdjacentRooms(current)) {
      if (depthByRoom.has(adjacent)) {
        continue
      }

      depthByRoom.set(adjacent, depth + 1)

      queue.push(adjacent)

      roomsByDepth[depth + 1].push(adjacent)
    }
  }

  return roomsByDepth
}
