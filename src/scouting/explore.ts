import { runtimeRegistry } from "../runtime/runtimeRegistry"
import { intelStore } from "../world/intel/intelStore"
import { getRoomType, getRoomsByDepth, isRoomReachable } from "../world/map/roomTopology"

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
      if (!isRoomReachable(roomName, colonyName)) {
        continue
      }

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
    map = getRoomsByDepth(colonyName, MAX_EXPLORE_DEPTH)
    exploreRoomsByColony.set(colonyName, map)
  }

  return map
}
