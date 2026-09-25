import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { basePlanStore } from "../../capabilities/basePlanning/basePlanStore"
import { findRoute } from "../../capabilities/movement/navigator"
import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import { type RoomIntel, type SourceIntel } from "../../world/intel/roomIntel"
import { getRoomsByDepth, getRoomType } from "../../world/map/roomTopology"
import { invalidateHarvestRuntime } from "./harvestRuntime"
import {
  createRemoteRoomData,
  getRemoteTotalDistance,
  type RemoteRoomData,
  type RemoteSourceData,
} from "./remoteRoomData"
import { remoteRoomDataStore } from "./remoteRoomDataStore"
import { createSourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"

const obstacleObjectTypes = new Set<string>(OBSTACLE_OBJECT_TYPES)

interface RemoteCandidateScore {
  readonly roomHops: number
  readonly totalDistance: number
}

interface RemoteCandidate extends RemoteCandidateScore {
  readonly data: RemoteRoomData
}

interface ColonyRouteCandidate {
  readonly room: Room
  readonly basePlan: BasePlan
  readonly route: readonly string[]
}

const MAX_REMOTE_DEPTH = 4
const MAX_REMOTE_DISTANCE = 200
const REMOTE_CHECK_INTERVAL = 1000

export function updateRemoteRoomFromIntel(roomName: string, context: TickContext, force = false): void {
  if (!sourceDataStore.isReady() || !remoteRoomDataStore.isReady() || !intelStore.isReady()) {
    return
  }

  Memory.rooms ??= {}
  const memory = (Memory.rooms[roomName] ??= {})

  if (
    !force &&
    memory.lastRemoteCheckTick !== undefined &&
    Game.time < memory.lastRemoteCheckTick + REMOTE_CHECK_INTERVAL
  ) {
    return
  }

  if (!checkRemoteRoom(roomName, context)) {
    return
  }

  memory.lastRemoteCheckTick = Game.time
}

export function initializeColonyRemotes(room: Room, basePlan: BasePlan, context: TickContext): boolean {
  if (!sourceDataStore.isReady() || !remoteRoomDataStore.isReady() || !intelStore.isReady()) {
    return false
  }

  const roomsByDepth = getRoomsByDepth(room.name, MAX_REMOTE_DEPTH)

  for (let depth = 1; depth <= MAX_REMOTE_DEPTH; depth++) {
    for (const remoteRoomName of roomsByDepth[depth]) {
      if (getRoomType(remoteRoomName) !== "normal") {
        continue
      }

      const intel = intelStore.get(remoteRoomName)

      if (!isRemoteCandidateIntel(intel)) {
        continue
      }

      ensureSourceData(intel)

      const existing = remoteRoomDataStore.get(remoteRoomName)

      if (existing?.colonyName === room.name) {
        continue
      }

      const route = findRemoteRoute(room.name, remoteRoomName)

      if (route === undefined) {
        continue
      }

      const candidate = createRemoteCandidate(room, basePlan, intel, route)

      if (candidate === undefined) {
        continue
      }

      if (existing !== undefined && context.ownedRooms.has(existing.colonyName)) {
        const existingRoute = findRemoteRoute(existing.colonyName, remoteRoomName)

        if (
          existingRoute !== undefined &&
          compareRemoteCandidateScores(candidate, {
            roomHops: existingRoute.length - 1,
            totalDistance: getRemoteTotalDistance(existing),
          }) >= 0
        ) {
          continue
        }
      }

      replaceRemote(existing, candidate.data)
    }
  }

  return true
}

function checkRemoteRoom(roomName: string, context: TickContext): boolean {
  const intel = intelStore.get(roomName)

  if (intel === undefined) {
    return false
  }

  const existing = remoteRoomDataStore.get(roomName)

  if (getRoomType(roomName) !== "normal" || !isRemoteCandidateIntel(intel)) {
    if (existing !== undefined) {
      removeRemote(existing)
    }

    return true
  }

  ensureSourceData(intel)

  if (existing !== undefined && isRemoteAssignmentValid(existing, intel, context)) {
    return true
  }

  if (existing !== undefined) {
    removeRemote(existing)
  }

  assignRemoteRoom(intel, context)

  return true
}

function isRemoteCandidateIntel(
  intel: RoomIntel | undefined,
): intel is RoomIntel & { controller: NonNullable<RoomIntel["controller"]> } {
  return intel?.controller !== undefined && intel.sources.length > 0 && intel.controller.owner === undefined
}

function isRemoteAssignmentValid(data: RemoteRoomData, intel: RoomIntel, context: TickContext): boolean {
  if (!context.ownedRooms.has(data.colonyName) || data.sources.length !== intel.sources.length) {
    return false
  }

  const assignedSourceIds = new Set(data.sources.map((source) => source.sourceId))

  for (const source of intel.sources) {
    if (!assignedSourceIds.has(source.id)) {
      return false
    }
  }

  return true
}

function assignRemoteRoom(intel: RoomIntel, context: TickContext): void {
  const routeCandidates: ColonyRouteCandidate[] = []
  const roomsByDepth = getRoomsByDepth(intel.roomName, MAX_REMOTE_DEPTH)

  for (let depth = 1; depth <= MAX_REMOTE_DEPTH; depth++) {
    for (const roomName of roomsByDepth[depth]) {
      const room = context.ownedRooms.get(roomName)

      if (room === undefined) {
        continue
      }

      const basePlanResult = basePlanStore.get(roomName)

      if (basePlanResult.status !== "ready") {
        continue
      }

      const route = findRemoteRoute(roomName, intel.roomName)

      if (route === undefined) {
        continue
      }

      routeCandidates.push({
        room,
        basePlan: basePlanResult.value,
        route,
      })
    }
  }

  routeCandidates.sort((left, right) => left.route.length - right.route.length)

  let best: RemoteCandidate | undefined

  for (const candidate of routeCandidates) {
    if (best !== undefined && candidate.route.length - 1 > best.roomHops) {
      break
    }

    const remoteCandidate = createRemoteCandidate(candidate.room, candidate.basePlan, intel, candidate.route)

    if (remoteCandidate === undefined) {
      continue
    }

    if (best === undefined || compareRemoteCandidateScores(remoteCandidate, best) < 0) {
      best = remoteCandidate
    }
  }

  if (best === undefined) {
    return
  }

  remoteRoomDataStore.set(best.data)
  invalidateHarvestRuntime(best.data.colonyName)
}

function compareRemoteCandidateScores(left: RemoteCandidateScore, right: RemoteCandidateScore): number {
  return left.roomHops - right.roomHops || left.totalDistance - right.totalDistance
}

function createRemoteCandidate(
  room: Room,
  basePlan: BasePlan,
  intel: RoomIntel,
  route: readonly string[],
): RemoteCandidate | undefined {
  const sources: RemoteSourceData[] = []
  let totalDistance = 0

  for (const source of intel.sources) {
    const path = findRemoteSourcePath(room, basePlan, intel.roomName, source, route)

    if (path === undefined || path.length > MAX_REMOTE_DISTANCE) {
      return
    }

    sources.push({
      sourceId: source.id,
      path,
    })
    totalDistance += path.length
  }

  return {
    data: createRemoteRoomData(intel.roomName, room.name, sources),
    roomHops: route.length - 1,
    totalDistance,
  }
}

function ensureSourceData(intel: RoomIntel): void {
  for (const source of intel.sources) {
    const result = sourceDataStore.get(source.id)

    if (result.status === "ready" && result.value.roomName === intel.roomName) {
      continue
    }

    if (result.status === "loading") {
      continue
    }

    sourceDataStore.set(createSourceData(source.id, intel.roomName, source.coordinate))
  }
}

function replaceRemote(existing: RemoteRoomData | undefined, next: RemoteRoomData): void {
  if (existing !== undefined && existing.colonyName !== next.colonyName) {
    invalidateHarvestRuntime(existing.colonyName)
  }

  remoteRoomDataStore.set(next)
  invalidateHarvestRuntime(next.colonyName)
}

function removeRemote(data: RemoteRoomData): void {
  remoteRoomDataStore.delete(data.roomName)
  invalidateHarvestRuntime(data.colonyName)
}

function findRemoteRoute(fromRoomName: string, remoteRoomName: string): readonly string[] | undefined {
  return findRoute(fromRoomName, remoteRoomName, {
    maxRoomHops: MAX_REMOTE_DEPTH,
    shouldExpand: (roomName) => canRouteRemoteThrough(roomName, fromRoomName),
  })
}

function findRemoteSourcePath(
  room: Room,
  basePlan: BasePlan,
  remoteRoomName: string,
  source: SourceIntel,
  route: readonly string[],
): readonly RoomPosition[] | undefined {
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
