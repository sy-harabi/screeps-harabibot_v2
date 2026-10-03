import { tryCreateConstructionSite } from "../../capabilities/construction/constructionSite"
import { getHarvestSourceMemory } from "./harvestMemory"
import { REMOTE_MAINTENANCE_INTERVAL } from "./remoteMaintenance"

export const REMOTE_ROAD_ENERGY_CAPACITY = 750

export function areRemoteRoadsEnabled(room: Room): boolean {
  return room.energyCapacityAvailable >= REMOTE_ROAD_ENERGY_CAPACITY
}

export interface RemoteConstructionSourceState {
  readonly active: boolean
  readonly complete: boolean
  readonly target?: RoomPosition
  readonly targetIndex?: number
}

export function activateRemoteConstructionSource(
  colonyRoom: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
): void {
  const sourceMemory = getHarvestSourceMemory(colonyRoom, sourceId)

  sourceMemory.useRoad = true
  sourceMemory.constructionRoadIndex = path.length - 2
  delete sourceMemory.roadsEstablished
}

export function runRemoteConstructionSource(
  colonyRoom: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
): RemoteConstructionSourceState {
  const sourceMemory = getHarvestSourceMemory(colonyRoom, sourceId)

  if (!sourceMemory.useRoad) {
    return { active: false, complete: false }
  }

  if (sourceMemory.roadsEstablished) {
    return { active: false, complete: true }
  }

  const containerIndex = path.length - 1
  const containerPos = path[containerIndex]

  if (containerPos === undefined) {
    return { active: false, complete: false }
  }

  if (!hasContainer(containerPos)) {
    ensureConstructionSite(containerPos, STRUCTURE_CONTAINER)

    return {
      active: true,
      complete: false,
      target: containerPos,
      targetIndex: containerIndex,
    }
  }

  let index = sourceMemory.constructionRoadIndex

  if (index === undefined) {
    finishRemoteConstruction(colonyRoom, sourceId)
    return { active: false, complete: true }
  }

  while (index >= 0) {
    const pos = path[index]

    if (pos === undefined) {
      index--
      continue
    }

    if (isRoomEdge(pos)) {
      index--
      continue
    }

    const room = Game.rooms[pos.roomName]

    if (room === undefined) {
      sourceMemory.constructionRoadIndex = index
      return {
        active: true,
        complete: false,
        target: pos,
        targetIndex: index,
      }
    }

    const road = room
      .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
      .find((structure) => structure.structureType === STRUCTURE_ROAD)

    if (road !== undefined) {
      index--
      continue
    }

    ensureConstructionSite(pos, STRUCTURE_ROAD)
    sourceMemory.constructionRoadIndex = index

    return {
      active: true,
      complete: false,
      target: pos,
      targetIndex: index,
    }
  }

  delete sourceMemory.constructionRoadIndex
  finishRemoteConstruction(colonyRoom, sourceId)

  return { active: false, complete: true }
}

function finishRemoteConstruction(room: Room, sourceId: Id<Source>): void {
  const sourceMemory = getHarvestSourceMemory(room, sourceId)

  sourceMemory.roadsEstablished = true
  sourceMemory.nextMaintenanceTick = Game.time + REMOTE_MAINTENANCE_INTERVAL
}

function hasContainer(pos: RoomPosition): boolean {
  const room = Game.rooms[pos.roomName]

  if (room === undefined) {
    return false
  }

  return room
    .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
    .some((structure) => structure.structureType === STRUCTURE_CONTAINER)
}

function ensureConstructionSite(pos: RoomPosition, structureType: BuildableStructureConstant): void {
  const room = Game.rooms[pos.roomName]

  if (room === undefined) {
    return
  }

  const siteExists = room
    .lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y)
    .some((site) => site.structureType === structureType)

  if (!siteExists) {
    tryCreateConstructionSite(room, pos.x, pos.y, structureType)
  }
}

function isRoomEdge(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
}
