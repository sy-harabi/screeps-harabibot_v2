import { runtimeRegistry } from "../runtime/runtimeRegistry"
import { getAdjacentRooms } from "../world/map/roomTopology"

interface ExploreMap {
  readonly depthByRoom: ReadonlyMap<string, number>
  readonly roomsByDepth: readonly (readonly string[])[]
}

const MAX_EXPLORE_DEPTH = 17

const EXPLORE_HORIZONS = [1, 3, 5, 9, 13, 17] as const

const exploreMaps = runtimeRegistry.createCache<string, ExploreMap>("scouting.exploreMaps", {
  cleanupInterval: 500,
  cleanup: (maps) => {
    for (const colonyName of maps.keys()) {
      if (Game.rooms[colonyName]?.controller?.my !== true) {
        maps.delete(colonyName)
      }
    }
  },
})

export function getExploreMap(colonyName: string): ExploreMap {
  let map = exploreMaps.get(colonyName)

  if (map === undefined) {
    map = createExploreMap(colonyName)
    exploreMaps.set(colonyName, map)
  }

  return map
}

function createExploreMap(colonyName: string): ExploreMap {
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

  return { depthByRoom, roomsByDepth }
}
