import { getMovementRuntime, MovementRuntime } from "./movementRuntime"
import { findPath } from "./navigator"
import { clearMoveRequest, registerMove } from "./traffic"

export type MoveStatus = "arrived" | "pending" | "blocked" | "failed"

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

type PathReconcileResult = "valid" | "invalid" | "stuck"

const REPATH_STUCK_TICKS = 5

export function moveCreep(creep: Creep, goals: MoveGoal | readonly MoveGoal[], options: MoveOptions = {}): MoveStatus {
  clearMoveRequest(creep)

  const normalizedGoals: MoveGoal[] = Array.isArray(goals) ? goals : [goals]

  if (normalizedGoals.length === 0) {
    return "failed"
  }

  if (normalizedGoals.some((goal) => goal.pos.getRangeTo(creep.pos) <= goal.range)) {
    return "arrived"
  }

  if (creep.fatigue > 0) {
    return "pending"
  }

  const runtime = getMovementRuntime(creep.name)
  const reconcileResult = reconcilePath(creep, runtime, normalizedGoals)

  runtime.lastObservedPosition = creep.pos

  if (reconcileResult !== "valid") {
    const blockedPos = reconcileResult === "stuck" ? getNextMovePosition(creep) : undefined
    const path =
      blockedPos === undefined
        ? findPath(creep.pos, normalizedGoals, options)
        : findPath(creep.pos, normalizedGoals, { ...options, avoidPosition: blockedPos })

    if (path === undefined) {
      if (reconcileResult === "stuck") {
        return "blocked"
      }

      runtime.cachedPath = undefined
      runtime.nextPathIndex = undefined
      return "failed"
    }

    runtime.cachedPath = path
    runtime.nextPathIndex = 0
  }

  const nextPos = getNextMovePosition(creep)

  if (nextPos === undefined) {
    runtime.cachedPath = undefined
    runtime.nextPathIndex = undefined
    return "failed"
  }

  registerMove(creep, nextPos, options.priority)
  runtime.lastMoveTick = Game.time

  return "pending"
}

export function getNextMovePosition(creep: Creep): RoomPosition | undefined {
  const runtime = getMovementRuntime(creep.name)
  const path = runtime.cachedPath
  const nextIndex = runtime.nextPathIndex

  if (path === undefined || nextIndex === undefined) {
    return
  }

  return path[nextIndex]
}

function reconcilePath(
  creep: Creep,
  runtime: MovementRuntime,
  normalizedGoals: MoveGoal[],
): PathReconcileResult {
  const path = runtime.cachedPath
  const nextIndex = runtime.nextPathIndex

  if (path === undefined || nextIndex === undefined) {
    return "invalid"
  }

  if (!isPathValid(path, normalizedGoals)) {
    return "invalid"
  }

  if (nextIndex < path.length && creep.pos.isEqualTo(path[nextIndex])) {
    runtime.nextPathIndex = nextIndex + 1
    runtime.stuckTicks = 0
    return "valid"
  }

  if (runtime.lastMoveTick === Game.time - 1 && runtime.lastObservedPosition?.isEqualTo(creep.pos)) {
    runtime.stuckTicks = (runtime.stuckTicks ?? 0) + 1

    if (runtime.stuckTicks >= REPATH_STUCK_TICKS) {
      runtime.stuckTicks = 0
      return "stuck"
    }

    return "valid"
  }

  const start = Math.max(0, nextIndex - 2)
  const end = Math.min(path.length - 1, nextIndex + 2)

  for (let i = end; i >= start; i--) {
    if (creep.pos.isNearTo(path[i])) {
      runtime.nextPathIndex = i
      runtime.stuckTicks = 0
      return "valid"
    }
  }

  return "invalid"
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
