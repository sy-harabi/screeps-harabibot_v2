import { tryCreateConstructionSite } from "../../capabilities/construction/constructionSite"

export const REMOTE_ROAD_ENERGY_CAPACITY = 750

const MAX_REMOTE_CONSTRUCTION_SITES = 3

export interface RemoteConstructionSourceMemory {
  useRoad?: boolean

  // Road construction progresses from source -> base.
  nextRoadIndex?: number

  // Used later for periodic maintenance.
  nextMaintenanceTick?: number
}

export interface RemoteConstructionMemory {
  sources: Record<string, RemoteConstructionSourceMemory>
}

export function areRemoteRoadsEnabled(room: Room): boolean {
  return room.energyCapacityAvailable >= REMOTE_ROAD_ENERGY_CAPACITY
}

export function getRemoteConstructionMemory(room: Room): RemoteConstructionMemory {
  return (room.memory.remoteConstruction ??= {
    sources: {},
  })
}

export function getRemoteConstructionSourceMemory(room: Room, sourceId: Id<Source>): RemoteConstructionSourceMemory {
  const memory = getRemoteConstructionMemory(room)

  return (memory.sources[sourceId] ??= {})
}

export interface RemoteConstructionSourceState {
  readonly active: boolean
  readonly complete: boolean
  readonly target?: RoomPosition
}

export function activateRemoteConstructionSource(
  colonyRoom: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
): void {
  const sourceMemory = getRemoteConstructionSourceMemory(colonyRoom, sourceId)

  sourceMemory.useRoad = true
  sourceMemory.nextRoadIndex = path.length - 2
}

export function runRemoteConstructionSource(
  colonyRoom: Room,
  sourceId: Id<Source>,
  path: readonly RoomPosition[],
): RemoteConstructionSourceState {
  const sourceMemory = getRemoteConstructionSourceMemory(colonyRoom, sourceId)

  if (!sourceMemory.useRoad) {
    return { active: false, complete: false }
  }

  const containerPos = path[path.length - 1]

  if (containerPos === undefined) {
    return { active: false, complete: false }
  }

  const containerState = handleContainer(containerPos)

  if (containerState !== "complete") {
    return {
      active: true,
      complete: false,
      target: containerPos,
    }
  }

  const nextRoadIndex = sourceMemory.nextRoadIndex

  if (nextRoadIndex === undefined) {
    const target = findRemoteConstructionTarget(path)

    return {
      active: target !== undefined,
      complete: target === undefined,
      target,
    }
  }

  let index = nextRoadIndex
  let activeSites = countRoadConstructionSites(path)

  while (index >= 0 && activeSites < MAX_REMOTE_CONSTRUCTION_SITES) {
    const pos = path[index]
    const room = Game.rooms[pos.roomName]

    if (room === undefined) {
      break
    }

    if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
      index--
      continue
    }

    const structures = room.lookForAt(LOOK_STRUCTURES, pos)

    if (structures.some((structure) => structure.structureType === STRUCTURE_ROAD)) {
      index--
      continue
    }

    const roadSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos).find((site) => site.structureType === STRUCTURE_ROAD)

    if (roadSite) {
      index--
      continue
    }

    const result = tryCreateConstructionSite(room, pos.x, pos.y, STRUCTURE_ROAD)

    if (result === OK) {
      activeSites++
      index--
      continue
    }

    break
  }

  sourceMemory.nextRoadIndex = index

  if (index < 0) {
    delete sourceMemory.nextRoadIndex
  }
  const target = findRemoteConstructionTarget(path) ?? (index >= 0 ? path[index] : undefined)

  return {
    active: activeSites > 0 || index >= 0,
    complete: index < 0 && activeSites === 0,
    target,
  }
}

function findRemoteConstructionTarget(path: readonly RoomPosition[]): RoomPosition | undefined {
  for (let i = path.length - 2; i >= 0; i--) {
    const pos = path[i]
    const room = Game.rooms[pos.roomName]

    if (room === undefined) {
      continue
    }

    const site = room
      .lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y)
      .find((site) => site.structureType === STRUCTURE_ROAD)

    if (site !== undefined) {
      return site.pos
    }
  }

  return undefined
}

function countRoadConstructionSites(path: readonly RoomPosition[]): number {
  let activeSites = 0

  for (const pos of path) {
    const room = Game.rooms[pos.roomName]
    if (room === undefined) {
      continue
    }

    if (room.lookForAt(LOOK_CONSTRUCTION_SITES, pos).some((site) => site.structureType === STRUCTURE_ROAD)) {
      activeSites++
    }
  }

  return activeSites
}

function handleContainer(pos: RoomPosition): "complete" | "constructing" | "waiting" {
  const room = Game.rooms[pos.roomName]

  if (room === undefined) {
    return "waiting"
  }

  const isContainer = room
    .lookForAt(LOOK_STRUCTURES, pos)
    .some((structure) => structure.structureType === STRUCTURE_CONTAINER)

  if (isContainer) {
    return "complete"
  }

  const isSite = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos).some((site) => site.structureType === STRUCTURE_CONTAINER)

  if (isSite) {
    return "constructing"
  }

  tryCreateConstructionSite(room, pos.x, pos.y, STRUCTURE_CONTAINER)

  return "constructing"
}
