import { getMovementRuntime, MovementRuntime } from "./movementRuntime"
import { findPath } from "./navigator"
import { clearMoveRequest, registerMove, run } from "./traffic"

export type MoveStatus = "arrived" | "pending" | "failed"

interface MoveOptions {
  useRoomRoute?: boolean

  // findRoute options
  maxRoomHops?: number
  getRoomCost?: (roomName: string) => number
  shouldExpand?: (roomName: string) => boolean

  // PathFinder options
  maxRooms?: number

  // move options
  priority?: number
}

export interface MoveGoal {
  pos: RoomPosition
  range: number
}

export function moveCreep(creep: Creep, goals: MoveGoal | readonly MoveGoal[], options: MoveOptions = {}): MoveStatus {
  clearMoveRequest(creep)

  const normalizedGoals: MoveGoal[] = Array.isArray(goals) ? goals : [goals]

  if (normalizedGoals.some((goal) => goal.pos.getRangeTo(creep.pos) <= goal.range)) {
    return "arrived"
  }

  if (creep.fatigue > 0) {
    return "pending"
  }

  const runtime = getMovementRuntime(creep.name)

  if (!reconcilePath(creep, runtime, normalizedGoals)) {
    runtime.cachedPath = undefined
    runtime.nextPathIndex = undefined
  }

  runtime.lastObservedPosition = creep.pos

  if (runtime.cachedPath === undefined) {
    const path = findPath(creep.pos, normalizedGoals, options)

    if (path === undefined) {
      return "failed"
    }

    runtime.cachedPath = path
    runtime.nextPathIndex = 0
  }

  const nextIndex = runtime.nextPathIndex!
  const nextPos = runtime.cachedPath[nextIndex]

  registerMove(creep, nextPos)

  return "pending"
}

function reconcilePath(creep: Creep, runtime: MovementRuntime, normalizedGoals: MoveGoal[]): boolean {
  const path = runtime.cachedPath

  let nextIndex = runtime.nextPathIndex

  if (path === undefined || nextIndex === undefined) {
    return false
  }

  if (!isPathValid(path, normalizedGoals)) {
    return false
  }

  if (nextIndex < path.length && creep.pos.isEqualTo(path[nextIndex])) {
    runtime.nextPathIndex = nextIndex + 1
    return true
  }

  if (runtime.lastObservedPosition?.isEqualTo(creep.pos)) {
    return true
  }

  const start = Math.max(0, nextIndex - 2)
  const end = Math.min(path.length - 1, nextIndex + 2)

  for (let i = end; i >= start; i--) {
    if (creep.pos.isNearTo(path[i])) {
      runtime.nextPathIndex = i
      return true
    }
  }

  // Too far off the path.
  return false
}

function isPathValid(path: readonly RoomPosition[], goals: MoveGoal[]) {
  if (path.length === 0) {
    return false
  }

  const end = path[path.length - 1]

  for (const goal of goals) {
    if (goal.pos.getRangeTo(end) <= goal.range) {
      return true
    }
  }

  return false
}
