import { getMovementRuntime, type MovementRuntime } from "./movementRuntime"
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

  // custom options
  avoidSourceKeepers?: boolean

  // move options
  priority?: number
}

interface MoveByPathOptions {
  reverse?: boolean
  priority?: number
}

export interface MoveGoal {
  pos: RoomPosition
  range: number
}

type PathReconcileResult = "valid" | "repath" | "blocked"

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
  const reconcileResult = reconcilePath(creep, runtime, normalizedGoals, options)

  runtime.lastObservedPosition = creep.pos

  if (reconcileResult === "blocked") {
    return "blocked"
  }

  if (reconcileResult === "repath") {
    const path = findPath(creep.pos, normalizedGoals, options)

    if (path === undefined) {
      clearPath(runtime)
      resetStuck(runtime)
      return "failed"
    }

    setPath(runtime, path, options)
  }

  const nextPos = getNextMovePosition(creep)

  if (nextPos === undefined) {
    clearPath(runtime)
    resetStuck(runtime)
    return "failed"
  }

  registerMove(creep, nextPos, options.priority)
  runtime.lastMoveTick = Game.time

  return "pending"
}

export function moveCreepByPath(
  creep: Creep,
  path: readonly RoomPosition[],
  options: MoveByPathOptions = {},
): MoveStatus {
  clearMoveRequest(creep)

  if (path.length === 0) {
    return "failed"
  }

  if (creep.fatigue > 0) {
    return "pending"
  }

  const runtime = getMovementRuntime(creep.name)
  const direction: 1 | -1 = options.reverse ? -1 : 1

  let nextIndex = runtime.knownPathIndex

  if (nextIndex === undefined) {
    nextIndex = initializeKnownPathIndex(creep, path, direction)
  } else {
    nextIndex = reconcileKnownPathIndex(creep, path, nextIndex, direction)
  }

  if (nextIndex === undefined) {
    return rejoinKnownPath(creep, path, options)
  }

  if (nextIndex < 0 || nextIndex >= path.length) {
    runtime.knownPathIndex = undefined
    return "arrived"
  }

  runtime.knownPathIndex = nextIndex

  registerMove(creep, path[nextIndex], options.priority)

  return "pending"
}

function rejoinKnownPath(creep: Creep, path: readonly RoomPosition[], options: MoveByPathOptions = {}): MoveStatus {
  const goals = path.map((pos) => ({ pos, range: 0 }))
  const result = moveCreep(creep, goals, { useRoomRoute: false, priority: options.priority })

  if (result !== "arrived") {
    return result
  }

  const runtime = getMovementRuntime(creep.name)
  const direction: 1 | -1 = options.reverse ? -1 : 1
  let currentIndex: number | undefined

  if (direction > 0) {
    for (let i = path.length - 1; i >= 0; i--) {
      if (creep.pos.isEqualTo(path[i])) {
        currentIndex = i
        break
      }
    }
  } else {
    for (let i = 0; i < path.length; i++) {
      if (creep.pos.isEqualTo(path[i])) {
        currentIndex = i
        break
      }
    }
  }

  if (currentIndex === undefined) {
    return "failed"
  }

  const nextIndex = currentIndex + direction

  if (nextIndex < 0 || nextIndex >= path.length) {
    runtime.knownPathIndex = undefined
    return "arrived"
  }

  runtime.knownPathIndex = nextIndex
  registerMove(creep, path[nextIndex], options.priority)

  return "pending"
}

function initializeKnownPathIndex(creep: Creep, path: readonly RoomPosition[], direction: 1 | -1): number | undefined {
  if (direction > 0) {
    const end = Math.min(path.length - 1, 2)
    for (let i = end; i >= 0; i--) {
      if (creep.pos.isNearTo(path[i])) {
        return i
      }
    }

    return
  } else {
    const start = Math.max(0, path.length - 3)

    for (let i = start; i <= path.length - 1; i++) {
      if (creep.pos.isNearTo(path[i])) {
        return i
      }
    }

    return
  }
}

function reconcileKnownPathIndex(
  creep: Creep,
  path: readonly RoomPosition[],
  nextIndex: number,
  direction: 1 | -1,
): number | undefined {
  if (nextIndex !== undefined && path[nextIndex] && creep.pos.isEqualTo(path[nextIndex])) {
    return nextIndex + direction
  }

  const start = Math.max(0, nextIndex - 2)
  const end = Math.min(path.length - 1, nextIndex + 2)

  if (direction === 1) {
    for (let i = end; i >= start; i--) {
      if (creep.pos.isNearTo(path[i])) {
        return i
      }
    }
  } else {
    for (let i = start; i <= end; i++) {
      if (creep.pos.isNearTo(path[i])) {
        return i
      }
    }
  }

  return
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
  options: MoveOptions,
): PathReconcileResult {
  const path = runtime.cachedPath
  const nextIndex = runtime.nextPathIndex

  if (path === undefined || nextIndex === undefined) {
    resetStuck(runtime)
    return "repath"
  }

  if (!pathMatchesGoals(path, normalizedGoals)) {
    resetStuck(runtime)
    return "repath"
  }

  const avoidSourceKeepers = options.avoidSourceKeepers === true

  if (runtime.avoidSourceKeepers !== avoidSourceKeepers) {
    resetStuck(runtime)
    return "repath"
  }

  if (nextIndex < path.length && creep.pos.isEqualTo(path[nextIndex])) {
    runtime.nextPathIndex = nextIndex + 1
    resetStuck(runtime)
    return "valid"
  }

  if (runtime.lastMoveTick === Game.time - 1 && runtime.lastObservedPosition?.isEqualTo(creep.pos)) {
    runtime.stuckTicks = (runtime.stuckTicks ?? 0) + 1

    if (runtime.stuckTicks < REPATH_STUCK_TICKS) {
      return "valid"
    }

    runtime.stuckTicks = 0

    if (runtime.stuckRepathAttempted) {
      resetStuck(runtime)
      return "blocked"
    }

    runtime.stuckRepathAttempted = true
    return "repath"
  }

  const start = Math.max(0, nextIndex - 2)
  const end = Math.min(path.length - 1, nextIndex + 2)

  for (let i = end; i >= start; i--) {
    if (creep.pos.isNearTo(path[i])) {
      runtime.nextPathIndex = i
      resetStuck(runtime)
      return "valid"
    }
  }

  resetStuck(runtime)
  return "repath"
}

function pathMatchesGoals(path: readonly RoomPosition[], goals: readonly MoveGoal[]): boolean {
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

function setPath(runtime: MovementRuntime, path: readonly RoomPosition[], options: MoveOptions): void {
  runtime.cachedPath = path
  runtime.pathCreatedAt = Game.time
  runtime.nextPathIndex = 0
  runtime.avoidSourceKeepers = options.avoidSourceKeepers === true
}

function clearPath(runtime: MovementRuntime): void {
  runtime.cachedPath = undefined
  runtime.nextPathIndex = undefined
}

function resetStuck(runtime: MovementRuntime): void {
  runtime.stuckTicks = 0
  runtime.stuckRepathAttempted = false
}
