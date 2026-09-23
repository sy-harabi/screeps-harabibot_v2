import { findRoute } from "../capabilities/movement/navigator"
import { runtimeRegistry } from "../runtime/runtimeRegistry"
import { intelStore } from "../world/intel/intelStore"
import { getExploreCandidates } from "./explore"

interface ScouterRuntime {
  targetRoomName?: string
}

const scouterRuntimes = runtimeRegistry.createCache<string, ScouterRuntime>("scouting.scouts", {
  cleanupInterval: 100,
  cleanup: (runtimes) => {
    for (const creepName of runtimes.keys()) {
      if (Game.creeps[creepName] === undefined) {
        runtimes.delete(creepName)
      }
    }
  },
})

function getExploreTarget(creep: Creep, colonyName: string): string | undefined {
  let runtime = scouterRuntimes.get(creep.name)

  if (runtime === undefined) {
    runtime = {}
    scouterRuntimes.set(creep.name, runtime)
  }

  const currentTarget = runtime.targetRoomName

  if (currentTarget !== undefined && !intelStore.has(currentTarget)) {
    return currentTarget
  }

  runtime.targetRoomName = undefined

  const candidates = getExploreCandidates(colonyName)

  if (candidates.length === 0) {
    return
  }

  const route = findRoute(creep.room.name, candidates, {
    maxRoomHops: 34,
  })

  if (route === undefined) {
    return
  }

  const targetRoomName = route[route.length - 1]

  runtime.targetRoomName = targetRoomName

  return targetRoomName
}
