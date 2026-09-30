import { runtimeRegistry } from "../../runtime/runtimeRegistry"

export interface MovementRuntime {
  cachedPath?: readonly RoomPosition[]
  pathCreatedAt?: number
  nextPathIndex?: number
  lastObservedPosition?: RoomPosition
  stuckTicks?: number
  lastMoveTick?: number
  stuckRepathAttempted?: boolean

  knownPathIndex?: number
  avoidSourceKeepers?: boolean
}

const movementRuntimes = runtimeRegistry.createCache<string, MovementRuntime>("movement.creeps", {
  cleanupInterval: 100,
  cleanup: (runtimes) => {
    for (const creepName of runtimes.keys()) {
      if (Game.creeps[creepName] === undefined) {
        runtimes.delete(creepName)
      }
    }
  },
})

export function getMovementRuntime(creepName: string): MovementRuntime {
  let runtime = movementRuntimes.get(creepName)

  if (runtime === undefined) {
    runtime = {}
    movementRuntimes.set(creepName, runtime)
  }

  return runtime
}

export function swapKnownPathIndex(firstName: string, secondName: string): void {
  const first = getMovementRuntime(firstName)
  const second = getMovementRuntime(secondName)
  const firstIndex = first.knownPathIndex

  first.knownPathIndex = second.knownPathIndex
  second.knownPathIndex = firstIndex
}
