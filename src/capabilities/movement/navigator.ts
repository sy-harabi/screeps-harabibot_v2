import { getRoomCostMatrix } from "../../world/navigation/roomCostMatrix"

export interface MoveGoal {
  pos: RoomPosition
  range: number
}

type MoveGoals = MoveGoal | MoveGoal[]

export type MoveStatus = "arrived" | "pending" | "failed"

export function findPath(origin: RoomPosition, goals: MoveGoals): readonly RoomPosition[] | undefined {
  const result = PathFinder.search(origin, goals, {
    maxRooms: 1,
    plainCost: 2,
    swampCost: 10,
    roomCallback: (roomName: string) => getRoomCostMatrix(roomName) || true,
  })

  if (result.incomplete) {
    return
  }

  return result.path
}
