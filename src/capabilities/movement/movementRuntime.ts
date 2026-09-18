import { getCreepHeap } from "../../runtime/creepRuntime"

interface CreepMovementRuntime {
  cachedPath?: readonly RoomPosition[]
  nextPathIndex?: number
  goalKey?: string
  lastObservedPosition?: RoomPosition
}

export function getMovementRuntime(creepName: string): CreepMovementRuntime {
  const heap = getCreepHeap(creepName)
  return (heap._movement ??= {})
}
