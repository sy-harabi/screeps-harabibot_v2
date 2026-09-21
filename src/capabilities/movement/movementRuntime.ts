import { getCreepHeap } from "../../runtime/creepRuntime"

interface MovementRuntime {
  cachedPath?: readonly RoomPosition[]
  nextPathIndex?: number
  goalKey?: string
  lastObservedPosition?: RoomPosition
}

interface MovementCreepHeap {
  movement?: MovementRuntime
}

export function getMovementRuntime(creepName: string): MovementRuntime {
  const heap = getCreepHeap<MovementCreepHeap>(creepName)
  return (heap.movement ??= {})
}
