import { getCreepHeap } from "../../runtime/creepRuntime"

interface MovementRuntime {
  cachedPath?: readonly RoomPosition[]
  nextPathIndex?: number
  goalKey?: string
  lastObservedPosition?: RoomPosition
}

interface MovementCreepRuntime {
  _movement?: MovementRuntime
}

export function getMovementRuntime(creepName: string): MovementRuntime {
  const runtime = getCreepHeap<MovementCreepRuntime>(creepName)

  return (runtime._movement ??= {})
}
