import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { OBSTACLE_OBJECT_TYPES_SET } from "../../world/obstacles"
import { getHarvestRuntime, type HaulerTravelRuntime } from "./harvestRuntime"

export function getHaulerTravelRuntime(
  basePlan: BasePlan,
  sourceId: Id<Source>,
  sourcePath: readonly RoomPosition[],
): HaulerTravelRuntime {
  const runtime = getHarvestRuntime(basePlan.roomName)

  runtime.haulerTravelBySource ??= new Map()

  const cached = runtime.haulerTravelBySource.get(sourceId)

  if (cached?.sourcePath === sourcePath) {
    return cached
  }

  const origin = new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName)

  const destination = sourcePath[sourcePath.length - 1]

  const goal = { pos: destination, range: 0 }

  const allowedRooms = new Set<string>()

  allowedRooms.add(basePlan.roomName)

  for (const pos of sourcePath) {
    allowedRooms.add(pos.roomName)
  }

  const emptyResult = PathFinder.search(origin, goal, {
    plainCost: 1,
    swampCost: 1,

    maxRooms: allowedRooms.size,
    maxOps: allowedRooms.size * 2000,

    roomCallback: (roomName: string) => {
      if (!allowedRooms.has(roomName)) {
        return false
      }

      return getHaulerCostMatrix(roomName, basePlan)
    },
  })

  const emptyPath = emptyResult.incomplete ? sourcePath : emptyResult.path

  const emptyTravelTicks = emptyPath.length

  const loadedResult = PathFinder.search(origin, goal, {
    plainCost: 1,
    swampCost: 5,

    maxRooms: allowedRooms.size,
    maxOps: allowedRooms.size * 2000,

    roomCallback: (roomName: string) => {
      if (!allowedRooms.has(roomName)) {
        return false
      }

      return getHaulerCostMatrix(roomName, basePlan)
    },
  })

  const loadedPath = loadedResult.incomplete ? sourcePath : loadedResult.path

  const loadedTravelTicks = loadedResult.incomplete ? estimatePathTravelTicks(sourcePath, 1, 1) : loadedResult.cost

  const cycleTravelTicks = emptyTravelTicks + loadedTravelTicks

  const result: HaulerTravelRuntime = {
    sourcePath,

    emptyPath,
    loadedPath,

    emptyTravelTicks,
    loadedTravelTicks,
    cycleTravelTicks,
  }

  runtime.haulerTravelBySource.set(sourceId, result)

  return result
}

function getHaulerCostMatrix(roomName: string, basePlan: BasePlan): CostMatrix | boolean {
  const base = getBaseRoomCostMatrix(roomName)

  if (roomName !== basePlan.roomName) {
    return base ?? true
  }

  const costs = base?.clone() ?? new PathFinder.CostMatrix()

  for (const structure of basePlan.structures) {
    if (!OBSTACLE_OBJECT_TYPES_SET.has(structure.structureType)) {
      continue
    }

    costs.set(structure.coordinate.x, structure.coordinate.y, 255)
  }

  return costs
}
