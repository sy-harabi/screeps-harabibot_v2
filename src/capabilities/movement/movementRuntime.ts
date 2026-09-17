interface CreepMovementRuntime {
  cachedPath?: readonly RoomPosition[]
  nextPathIndex?: number
  goalKey?: string
  lastObservedPosition?: RoomPosition
}
