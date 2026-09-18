import { getCreepHeap } from "../../runtime/creepRuntime"

export interface MovementRuntime {
  cachedPath?: readonly RoomPosition[]
  nextPathIndex?: number
  lastObservedPosition?: RoomPosition
}

interface MovementCreepRuntime {
  _movement?: MovementRuntime
}

export function getMovementRuntime(creepName: string): MovementRuntime {
  const runtime = getCreepHeap<MovementCreepRuntime>(creepName)

  return (runtime._movement ??= {})
}
