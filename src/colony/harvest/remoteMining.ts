import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { findRoute } from "../../capabilities/movement/navigator"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { getExploreRoomsByDepth } from "../../scouting/explore"
import { intelStore } from "../../world/intel/intelStore"
import { type RoomIntel, type SourceIntel } from "../../world/intel/roomIntel"
import { getRoomType } from "../../world/map/roomTopology"
import { invalidateHarvestRuntime } from "./harvestRuntime"
import { createSourceData, type SourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"

const obstacleObjectTypes = new Set<string>(OBSTACLE_OBJECT_TYPES)

interface ExistingRemote {
  readonly colonyName: string
  readonly totalDistance: number
}

interface RemoteCandidate {
  readonly sources: readonly SourceData[]
  readonly totalDistance: number
}

const MAX_REMOTE_DEPTH = 4
const MAX_REMOTE_DISTANCE = 200

const initializedColonies = new Set<string>()

export function refreshRemoteSources(
  room: Room,
  basePlan: BasePlan,
  newlyObservedRooms: readonly string[],
): void {
  if (!sourceDataStore.isReady() || !intelStore.isReady()) {
    return
  }

  const roomsByDepth = getExploreRoomsByDepth(room.name)

  if (!initializedColonies.has(room.name)) {
    initializedColonies.add(room.name)

    for (let depth = 1; depth <= MAX_REMOTE_DEPTH; depth++) {
      for (const roomName of roomsByDepth[depth]) {
        checkRemoteRoom(room, basePlan, roomName)
      }
    }

    return
  }

  for (const roomName of newlyObservedRooms) {
    if (!isWithinRemoteDepth(roomsByDepth, roomName)) {
      continue
    }

    checkRemoteRoom(room, basePlan, roomName)
  }
}

function isWithinRemoteDepth(roomsByDepth: readonly (readonly string[])[], roomName: string): boolean {
  for (let depth = 1; depth <= MAX_REMOTE_DEPTH; depth++) {
    if (roomsByDepth[depth].includes(roomName)) {
      return true
    }
  }

  return false
}

function checkRemoteRoom(room: Room, basePlan: BasePlan, remoteRoomName: string): void {
  if (getRoomType(remoteRoomName) !== "normal") {
    return
  }

  const intel = intelStore.get(remoteRoomName)

  if (!intel?.controller || intel.sources.length === 0) {
    return
  }

  if (intel.controller.owner !== undefined) {
    return
  }

  tryTakeRemote(room, basePlan, intel)
}

function tryTakeRemote(room: Room, basePlan: BasePlan, intel: RoomIntel): void {
  const existing = getExistingRemote(intel)

  if (existing?.colonyName === room.name) {
    return
  }

  const candidate = createRemoteCandidate(room, basePlan, intel)

  if (!candidate) {
    return
  }

  if (existing !== undefined && existing.totalDistance <= candidate.totalDistance) {
    return
  }

  for (const sourceData of candidate.sources) {
    sourceDataStore.set(sourceData)
  }

  const oldColonyName = existing?.colonyName

  if (oldColonyName !== undefined) {
    invalidateHarvestRuntime(oldColonyName)
  }

  invalidateHarvestRuntime(room.name)
}

function getExistingRemote(intel: RoomIntel): ExistingRemote | undefined {
  let colonyName: string | undefined
  let totalDistance = 0

  for (const source of intel.sources) {
    const result = sourceDataStore.get(source.id)

    if (result.status !== "ready") {
      return
    }

    const data = result.value

    if (data.roomName !== intel.roomName) {
      return
    }

    if (colonyName === undefined) {
      colonyName = data.colonyName
    } else if (data.colonyName !== colonyName) {
      return
    }

    totalDistance += data.path.length
  }

  return colonyName === undefined
    ? undefined
    : {
        colonyName,
        totalDistance,
      }
}

function createRemoteCandidate(room: Room, basePlan: BasePlan, intel: RoomIntel): RemoteCandidate | undefined {
  const sources: SourceData[] = []
  let totalDistance = 0

  for (const source of intel.sources) {
    const path = findRemoteSourcePath(room, basePlan, intel.roomName, source)

    if (path === undefined || path.length > MAX_REMOTE_DISTANCE) {
      return
    }

    sources.push(createSourceData(source.id, intel.roomName, source.coordinate, room.name, path))

    totalDistance += path.length
  }

  return {
    sources,
    totalDistance,
  }
}

function findRemoteSourcePath(
  room: Room,
  basePlan: BasePlan,
  remoteRoomName: string,
  source: SourceIntel,
): readonly RoomPosition[] | undefined {
  const route = findRoute(room.name, remoteRoomName, {
    maxRoomHops: MAX_REMOTE_DEPTH,
    shouldExpand: (roomName) => canRouteRemoteThrough(roomName, room.name),
  })

  if (!route) {
    return
  }

  const allowedRooms = new Set(route)

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, room.name),
    {
      pos: new RoomPosition(source.coordinate.x, source.coordinate.y, remoteRoomName),
      range: 1,
    },
    {
      plainCost: 2,
      swampCost: 10,
      maxRooms: allowedRooms.size,
      maxOps: allowedRooms.size * 2000,

      roomCallback: (roomName) => {
        if (!allowedRooms.has(roomName)) {
          return false
        }

        const base = getBaseRoomCostMatrix(roomName)
        const costs = base?.clone() ?? new PathFinder.CostMatrix()

        if (roomName === room.name) {
          applyBasePlanCosts(costs, basePlan)
        }

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}

function applyBasePlanCosts(costs: CostMatrix, basePlan: BasePlan): void {
  for (const structure of basePlan.structures) {
    if (structure.structureType === STRUCTURE_ROAD) {
      if (costs.get(structure.coordinate.x, structure.coordinate.y) !== 255) {
        costs.set(structure.coordinate.x, structure.coordinate.y, 1)
      }

      continue
    }

    if (structure.structureType === STRUCTURE_CONTAINER || obstacleObjectTypes.has(structure.structureType)) {
      costs.set(structure.coordinate.x, structure.coordinate.y, 255)
    }
  }
}

function canRouteRemoteThrough(roomName: string, fromRoomName: string): boolean {
  if (roomName === fromRoomName) {
    return true
  }

  const type = getRoomType(roomName)

  if (type === "keeper" || type === "center") {
    return false
  }

  const intel = intelStore.get(roomName)

  return !intel?.controller?.owner
}
