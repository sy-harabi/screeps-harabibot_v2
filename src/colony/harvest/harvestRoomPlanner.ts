import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import { findRoute } from "../../capabilities/movement/navigator"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import type { TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { RoomIntel, SourceIntel } from "../../world/intel/roomIntel"
import { getRoomType, getRoomsByDepth } from "../../world/map/roomTopology"
import type { HarvestRoomPlan, HarvestSourcePlan } from "./harvestRoomPlan"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"

interface RemotePathContext {
  readonly roadPositionsByRoom: Map<string, Set<number>>
  readonly containerPositionsByRoom: Map<string, Set<number>>
}

interface RemoteCandidate {
  readonly plan: HarvestRoomPlan
  readonly roomHops: number
  readonly totalPathLength: number
}

const obstacleObjectTypes = new Set<string>(OBSTACLE_OBJECT_TYPES)

const MAX_REMOTE_DEPTH = 4

const REMOTE_ROAD_COST = 4
const REMOTE_PLAIN_COST = 5
const REMOTE_SWAMP_COST = 6
const REMOTE_CONTAINER_COST = 255

export function planHarvestRoom(roomName: string, colonyName: string, basePlan: BasePlan): HarvestRoomPlan | undefined {
  if (!harvestRoomPlanStore.isReady()) {
    return
  }

  const existing = harvestRoomPlanStore.get(roomName)

  if (existing !== undefined && existing.colonyName === colonyName && existing.basePlanRevision === basePlan.revision) {
    return existing
  }

  const intel = intelStore.get(roomName)

  if (intel === undefined) {
    return
  }

  const plan = createHarvestRoomPlan(roomName, colonyName, basePlan, intel)

  if (plan === undefined) {
    return
  }

  harvestRoomPlanStore.set(roomName, plan)

  return plan
}

export function assignRemoteHarvestRoom(roomName: string, context: TickContext): HarvestRoomPlan | undefined {
  if (!harvestRoomPlanStore.isReady() || !intelStore.isReady() || context.ownedRooms.has(roomName)) {
    return
  }

  if (harvestRoomPlanStore.get(roomName) !== undefined) {
    return
  }

  const intel = intelStore.get(roomName)

  if (!isRemoteCandidateIntel(intel) || getRoomType(roomName) !== "normal") {
    return
  }

  const roomsByDepth = getRoomsByDepth(roomName, MAX_REMOTE_DEPTH)
  let best: RemoteCandidate | undefined

  for (let depth = 1; depth <= MAX_REMOTE_DEPTH; depth++) {
    let foundCandidateAtDepth = false

    for (const colonyName of roomsByDepth[depth]) {
      if (!context.ownedRooms.has(colonyName)) {
        continue
      }

      const basePlanResult = basePlanStore.get(colonyName)

      if (basePlanResult.status !== "ready") {
        continue
      }

      const route = findRemoteRoute(colonyName, roomName)

      if (route === undefined) {
        continue
      }

      const roomHops = route.length - 1

      if (roomHops !== depth) {
        continue
      }

      const plan = createHarvestRoomPlan(roomName, colonyName, basePlanResult.value, intel, route)

      if (plan === undefined) {
        continue
      }

      foundCandidateAtDepth = true

      const candidate: RemoteCandidate = {
        plan,
        roomHops,
        totalPathLength: getTotalPathLength(plan),
      }

      if (best === undefined || compareRemoteCandidates(candidate, best) < 0) {
        best = candidate
      }
    }

    if (foundCandidateAtDepth) {
      break
    }
  }

  if (best === undefined) {
    return
  }

  harvestRoomPlanStore.set(roomName, best.plan)

  return best.plan
}

function createHarvestRoomPlan(
  roomName: string,
  colonyName: string,
  basePlan: BasePlan,
  intel: RoomIntel,
  route?: readonly string[],
): HarvestRoomPlan | undefined {
  const sources = planHarvestSourcePaths(roomName, colonyName, basePlan, intel.sources, route)

  if (sources === undefined) {
    return
  }

  return {
    colonyName,
    basePlanRevision: basePlan.revision,
    sources,
  }
}

function planHarvestSourcePaths(
  roomName: string,
  colonyName: string,
  basePlan: BasePlan,
  sources: readonly SourceIntel[],
  route?: readonly string[],
): ReadonlyMap<Id<Source>, HarvestSourcePlan> | undefined {
  if (roomName === colonyName) {
    return planOwnedSourcePaths(basePlan, sources)
  }

  const remoteRoute = route ?? findRemoteRoute(colonyName, roomName)

  if (remoteRoute === undefined) {
    return
  }

  return planRemoteSourcePaths(roomName, colonyName, basePlan, sources, remoteRoute)
}

function planOwnedSourcePaths(
  basePlan: BasePlan,
  sources: readonly SourceIntel[],
): ReadonlyMap<Id<Source>, HarvestSourcePlan> | undefined {
  const result = new Map<Id<Source>, HarvestSourcePlan>()

  for (const source of sources) {
    const path = findOwnedSourcePath(source, basePlan)

    if (path === undefined) {
      return
    }

    result.set(source.id, { path })
  }

  return result
}

function planRemoteSourcePaths(
  roomName: string,
  colonyName: string,
  basePlan: BasePlan,
  sources: readonly SourceIntel[],
  route: readonly string[],
): ReadonlyMap<Id<Source>, HarvestSourcePlan> | undefined {
  const result = new Map<Id<Source>, HarvestSourcePlan>()
  const pathContext = createRemotePathContext(colonyName, roomName)

  for (const source of sources) {
    const path = findRemoteSourcePath(basePlan, roomName, source, route, pathContext)

    if (path === undefined) {
      return
    }

    result.set(source.id, { path })
    addRemotePath(pathContext, path)
  }

  return result
}

function findOwnedSourcePath(source: SourceIntel, basePlan: BasePlan): RoomPosition[] | undefined {
  const container = basePlan.structures.find(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.tag?.kind === "source" &&
      structure.tag.id === source.id,
  )

  if (container === undefined) {
    return
  }

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(container.coordinate.x, container.coordinate.y, basePlan.roomName),
      range: 0,
    },
    {
      plainCost: 255,
      swampCost: 255,
      maxRooms: 1,
      roomCallback: () => {
        const costs = new PathFinder.CostMatrix()

        for (const structure of basePlan.structures) {
          if (structure.structureType === STRUCTURE_ROAD) {
            costs.set(structure.coordinate.x, structure.coordinate.y, 1)
          }
        }

        costs.set(container.coordinate.x, container.coordinate.y, 1)

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}

function findRemoteSourcePath(
  basePlan: BasePlan,
  remoteRoomName: string,
  source: SourceIntel,
  route: readonly string[],
  pathContext: RemotePathContext,
): readonly RoomPosition[] | undefined {
  const allowedRooms = new Set(route)

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(source.coordinate.x, source.coordinate.y, remoteRoomName),
      range: 1,
    },
    {
      plainCost: REMOTE_PLAIN_COST,
      swampCost: REMOTE_SWAMP_COST,
      maxRooms: allowedRooms.size,
      maxOps: allowedRooms.size * 2000,
      roomCallback: (roomName) => {
        if (!allowedRooms.has(roomName)) {
          return false
        }

        const base = getBaseRoomCostMatrix(roomName)
        const costs = base?.clone() ?? new PathFinder.CostMatrix()

        normalizeExistingRoadCosts(costs, roomName)

        if (roomName === basePlan.roomName) {
          applyBasePlanCosts(costs, basePlan)
        }

        applyRemotePathCosts(costs, roomName, pathContext)
        blockVisibleContainers(costs, roomName)

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}

function createRemotePathContext(colonyName: string, excludedRoomName: string): RemotePathContext {
  const context: RemotePathContext = {
    roadPositionsByRoom: new Map(),
    containerPositionsByRoom: new Map(),
  }

  for (const roomName of harvestRoomPlanStore.getByColony(colonyName)) {
    if (roomName === colonyName || roomName === excludedRoomName) {
      continue
    }

    const plan = harvestRoomPlanStore.get(roomName)

    if (plan === undefined) {
      continue
    }

    for (const source of plan.sources.values()) {
      addRemotePath(context, source.path)
    }
  }

  return context
}

function addRemotePath(context: RemotePathContext, path: readonly RoomPosition[]): void {
  for (const pos of path) {
    addRemotePosition(context.roadPositionsByRoom, pos)
  }

  const container = path[path.length - 1]

  if (container !== undefined) {
    addRemotePosition(context.containerPositionsByRoom, container)
  }
}

function addRemotePosition(positionsByRoom: Map<string, Set<number>>, pos: RoomPosition): void {
  let positions = positionsByRoom.get(pos.roomName)

  if (positions === undefined) {
    positions = new Set()
    positionsByRoom.set(pos.roomName, positions)
  }

  positions.add(pos.y * 50 + pos.x)
}

function applyRemotePathCosts(costs: CostMatrix, roomName: string, context: RemotePathContext): void {
  const roads = context.roadPositionsByRoom.get(roomName)

  if (roads !== undefined) {
    for (const index of roads) {
      const x = index % 50
      const y = Math.floor(index / 50)

      if (costs.get(x, y) !== 255) {
        costs.set(x, y, REMOTE_ROAD_COST)
      }
    }
  }

  const containers = context.containerPositionsByRoom.get(roomName)

  if (containers !== undefined) {
    for (const index of containers) {
      costs.set(index % 50, Math.floor(index / 50), REMOTE_CONTAINER_COST)
    }
  }
}

function applyBasePlanCosts(costs: CostMatrix, basePlan: BasePlan): void {
  for (const structure of basePlan.structures) {
    if (structure.structureType === STRUCTURE_ROAD) {
      if (costs.get(structure.coordinate.x, structure.coordinate.y) !== 255) {
        costs.set(structure.coordinate.x, structure.coordinate.y, REMOTE_ROAD_COST)
      }
      continue
    }

    if (structure.structureType === STRUCTURE_CONTAINER || obstacleObjectTypes.has(structure.structureType)) {
      costs.set(structure.coordinate.x, structure.coordinate.y, 255)
    }
  }
}

function normalizeExistingRoadCosts(costs: CostMatrix, roomName: string): void {
  const room = Game.rooms[roomName]

  if (room === undefined) {
    return
  }

  for (const structure of room.find(FIND_STRUCTURES)) {
    if (structure.structureType === STRUCTURE_ROAD && costs.get(structure.pos.x, structure.pos.y) !== 255) {
      costs.set(structure.pos.x, structure.pos.y, REMOTE_ROAD_COST)
    }
  }
}

function blockVisibleContainers(costs: CostMatrix, roomName: string): void {
  const room = Game.rooms[roomName]

  if (room === undefined) {
    return
  }

  for (const structure of room.find(FIND_STRUCTURES)) {
    if (structure.structureType === STRUCTURE_CONTAINER) {
      costs.set(structure.pos.x, structure.pos.y, REMOTE_CONTAINER_COST)
    }
  }
}

function findRemoteRoute(colonyName: string, remoteRoomName: string): readonly string[] | undefined {
  return findRoute(colonyName, remoteRoomName, {
    maxRoomHops: MAX_REMOTE_DEPTH,
    shouldExpand: (roomName) => canRouteRemoteThrough(roomName, colonyName),
  })
}

function canRouteRemoteThrough(roomName: string, colonyName: string): boolean {
  if (roomName === colonyName) {
    return true
  }

  const type = getRoomType(roomName)

  if (type === "keeper" || type === "center") {
    return false
  }

  return intelStore.get(roomName)?.controller?.owner === undefined
}

function isRemoteCandidateIntel(
  intel: RoomIntel | undefined,
): intel is RoomIntel & { controller: NonNullable<RoomIntel["controller"]> } {
  return intel?.controller !== undefined && intel.sources.length > 0 && intel.controller.owner === undefined
}

function getTotalPathLength(plan: HarvestRoomPlan): number {
  let total = 0

  for (const source of plan.sources.values()) {
    total += source.path.length
  }

  return total
}

function compareRemoteCandidates(left: RemoteCandidate, right: RemoteCandidate): number {
  return (
    left.roomHops - right.roomHops ||
    left.totalPathLength - right.totalPathLength ||
    left.plan.colonyName.localeCompare(right.plan.colonyName)
  )
}
