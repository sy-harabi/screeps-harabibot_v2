import type { HarvestSourceState } from "./harvestState"
import { getHarvestMemory, getHarvestSourceMemory } from "./harvestMemory"

export const REMOTE_MAINTENANCE_INTERVAL = 100

const ROAD_TRIGGER_RATIO = 0.3
const RECENT_READY_TICKS = CREEP_LIFE_TIME

export function getRemoteMaintenanceSourceId(room: Room): Id<Source> | undefined {
  return getHarvestMemory(room).maintenance?.sourceId
}

export function inspectRemoteMaintenanceSource(room: Room, source: HarvestSourceState): void {
  const harvestMemory = getHarvestMemory(room)

  if (harvestMemory.maintenance !== undefined) {
    return
  }

  const sourceMemory = getHarvestSourceMemory(room, source.id)

  if (!sourceMemory.roadsEstablished) {
    return
  }

  if (sourceMemory.nextMaintenanceTick !== undefined && Game.time < sourceMemory.nextMaintenanceTick) {
    return
  }

  sourceMemory.nextMaintenanceTick = Game.time + REMOTE_MAINTENANCE_INTERVAL

  if (!needsMaintenance(source.path)) {
    return
  }

  harvestMemory.maintenance = {
    startSourceId: source.id,
    sourceId: source.id,
    pathIndex: source.path.length - 1,
  }
}

export function reconcileRemoteMaintenance(room: Room, sources: readonly HarvestSourceState[]): void {
  const maintenance = getHarvestMemory(room).maintenance

  if (maintenance === undefined) {
    return
  }

  const startSource = sources.find((source) => source.id === maintenance.startSourceId)
  const currentSource = sources.find((source) => source.id === maintenance.sourceId)

  if (startSource === undefined || currentSource === undefined) {
    delete getHarvestMemory(room).maintenance
    return
  }

  if (maintenance.pathIndex >= currentSource.path.length) {
    maintenance.pathIndex = currentSource.path.length - 1
  }

  if (maintenance.pathIndex < 0) {
    advanceRemoteMaintenanceSource(room, sources)
  }
}

export function advanceRemoteMaintenanceSource(room: Room, sources: readonly HarvestSourceState[]): boolean {
  const harvestMemory = getHarvestMemory(room)
  const maintenance = harvestMemory.maintenance

  if (maintenance === undefined) {
    return false
  }

  const currentIndex = sources.findIndex((source) => source.id === maintenance.sourceId)
  const startIndex = sources.findIndex((source) => source.id === maintenance.startSourceId)

  if (currentIndex < 0 || startIndex < 0) {
    delete harvestMemory.maintenance
    return false
  }

  const currentSource = sources[currentIndex]
  getHarvestSourceMemory(room, currentSource.id).nextMaintenanceTick = Game.time + REMOTE_MAINTENANCE_INTERVAL

  for (let offset = 1; offset <= sources.length; offset++) {
    const candidate = sources[(currentIndex + offset) % sources.length]

    if (candidate.id === maintenance.startSourceId) {
      delete harvestMemory.maintenance
      return false
    }

    if (!isSweepSourceEligible(room, candidate)) {
      continue
    }

    maintenance.sourceId = candidate.id
    maintenance.pathIndex = candidate.path.length - 1
    return true
  }

  delete harvestMemory.maintenance
  return false
}

function isSweepSourceEligible(room: Room, source: HarvestSourceState): boolean {
  if (source.roomName === room.name) {
    return false
  }

  const sourceMemory = getHarvestSourceMemory(room, source.id)

  return (
    sourceMemory.roadsEstablished === true &&
    sourceMemory.lastReadyTick !== undefined &&
    Game.time - sourceMemory.lastReadyTick <= RECENT_READY_TICKS
  )
}

function needsMaintenance(path: readonly RoomPosition[]): boolean {
  const containerPos = path[path.length - 1]

  if (containerPos !== undefined) {
    const room = Game.rooms[containerPos.roomName]

    if (room !== undefined) {
      const hasContainer = room
        .lookForAt(LOOK_STRUCTURES, containerPos.x, containerPos.y)
        .some((structure) => structure.structureType === STRUCTURE_CONTAINER)

      if (!hasContainer) {
        return true
      }
    }
  }

  for (let i = path.length - 2; i >= 0; i--) {
    const pos = path[i]

    if (isRoomEdge(pos)) {
      continue
    }

    const room = Game.rooms[pos.roomName]

    if (room === undefined) {
      continue
    }

    const road = room
      .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
      .find((structure) => structure.structureType === STRUCTURE_ROAD)

    if (road === undefined || road.hits <= road.hitsMax * ROAD_TRIGGER_RATIO) {
      return true
    }
  }

  return false
}

function isRoomEdge(pos: RoomPosition): boolean {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
}
