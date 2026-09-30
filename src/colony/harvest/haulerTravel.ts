import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { estimatePathTravelTicks } from "../../capabilities/movement/travelTime"
import { getBotOptions } from "../../options/botOptions"
import { fromRoomIndex, toRoomIndex } from "../../world/map/roomGrid"
import { OBSTACLE_OBJECT_TYPES_SET } from "../../world/obstacles"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { getHarvestRuntime, type HaulerTravelRuntime } from "./harvestRuntime"

type ContainerPositionsByRoom = Map<string, Set<number>>

export function getHaulerTravelRuntime(
  basePlan: BasePlan,
  sourceId: Id<Source>,
  sourcePath: readonly RoomPosition[],
): HaulerTravelRuntime {
  const runtime = getHarvestRuntime(basePlan.roomName)

  runtime.haulerTravelBySource ??= new Map()

  const cached = runtime.haulerTravelBySource.get(sourceId)
  const speedrun = getBotOptions().speedrun

  if (cached?.sourcePath === sourcePath && cached.speedrun === speedrun) {
    return cached
  }

  if (speedrun) {
    const sharedPath = sourcePath.slice(0, -1)
    const emptyTravelTicks = sharedPath.length
    const loadedTravelTicks = estimatePathTravelTicks(sharedPath, 1, 1)
    const result: HaulerTravelRuntime = {
      sourcePath,
      speedrun,

      emptyPath: sharedPath,
      loadedPath: sharedPath,

      emptyTravelTicks,
      loadedTravelTicks,
      cycleTravelTicks: emptyTravelTicks + loadedTravelTicks,
    }

    runtime.haulerTravelBySource.set(sourceId, result)
    return result
  }

  const containerPositionsByRoom = createContainerPositionsByRoom(basePlan.roomName)

  const origin = new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName)

  const destination = sourcePath[sourcePath.length - 2]

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

      return getHaulerCostMatrix(roomName, basePlan, destination, containerPositionsByRoom)
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

      return getHaulerCostMatrix(roomName, basePlan, destination, containerPositionsByRoom)
    },
  })

  const loadedPath = loadedResult.incomplete ? sourcePath : loadedResult.path

  const loadedTravelTicks = loadedResult.incomplete ? estimatePathTravelTicks(sourcePath, 1, 1) : loadedResult.cost

  const cycleTravelTicks = emptyTravelTicks + loadedTravelTicks

  const result: HaulerTravelRuntime = {
    sourcePath,
    speedrun,

    emptyPath,
    loadedPath,

    emptyTravelTicks,
    loadedTravelTicks,
    cycleTravelTicks,
  }

  runtime.haulerTravelBySource.set(sourceId, result)

  return result
}

function getHaulerCostMatrix(
  roomName: string,
  basePlan: BasePlan,
  destination: RoomPosition,
  containerPositionsByRoom: ContainerPositionsByRoom,
): CostMatrix | boolean {
  const base = getBaseRoomCostMatrix(roomName)

  if (roomName === basePlan.roomName) {
    const costs = base?.clone() ?? new PathFinder.CostMatrix()

    for (const structure of basePlan.structures) {
      if (OBSTACLE_OBJECT_TYPES_SET.has(structure.structureType) || structure.structureType === STRUCTURE_CONTAINER) {
        costs.set(structure.coordinate.x, structure.coordinate.y, 255)
      }
    }

    return costs
  }

  const costs = base ? base.clone() : new PathFinder.CostMatrix()

  applyPlannedContainerCosts(costs, roomName, destination, containerPositionsByRoom)

  return costs
}

function applyPlannedContainerCosts(
  costs: CostMatrix,
  roomName: string,
  destination: RoomPosition,
  containerPositionsByRoom: ContainerPositionsByRoom,
): void {
  const containers = containerPositionsByRoom.get(roomName)

  if (containers === undefined) {
    return
  }

  for (const index of containers) {
    const { x, y } = fromRoomIndex(index)

    if (roomName === destination.roomName && x === destination.x && y === destination.y) {
      continue
    }

    costs.set(x, y, 255)
  }
}

function createContainerPositionsByRoom(colonyName: string): ContainerPositionsByRoom {
  const containerPositionsByRoom: Map<string, Set<number>> = new Map()

  for (const roomName of harvestRoomPlanStore.getByColony(colonyName)) {
    if (roomName === colonyName) {
      continue
    }

    const plan = harvestRoomPlanStore.get(roomName)

    if (plan === undefined) {
      continue
    }

    for (const source of plan.sources.values()) {
      const container = source.path[source.path.length - 1]

      if (container === undefined) {
        continue
      }

      const containerPositions = containerPositionsByRoom.get(container.roomName)

      if (containerPositions === undefined) {
        containerPositionsByRoom.set(roomName, new Set([toRoomIndex(container.x, container.y)]))
        continue
      }

      containerPositions.add(toRoomIndex(container.x, container.y))
    }
  }

  return containerPositionsByRoom
}
