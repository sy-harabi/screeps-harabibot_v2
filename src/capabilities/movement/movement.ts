import { getMovementRuntime } from "./movementRuntime"

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
  const normalizedGoals: MoveGoal[] = Array.isArray(goals) ? goals : [goals]

  if (normalizedGoals.some((goal) => goal.pos.getRangeTo(creep.pos) < goal.range)) {
    return "arrived"
  }

  const runtime = getMovementRuntime(creep.name)
  const goalKey = createGoalKey(normalizedGoals)

  if (runtime.goalKey !== goalKey) {
    runtime.cachedPath = undefined
    runtime.nextPathIndex = undefined
    runtime.goalKey = goalKey
  }

  return "pending"
}

function createGoalKey(goals: readonly MoveGoal[]): string {
  return goals.map((goal) => `${goal.pos.roomName}:${goal.pos.x}:${goal.pos.y}:${goal.range}`).join("|")
}
