import { getRange, type RoomCoordinate } from "../../world/map/roomCoordinate"
import { isInsideRoom, NEIGHBOR_OFFSETS, toRoomIndex } from "../../world/map/roomGrid"
import { moveCreep } from "./movement"

interface FillAreaOptions {
  getPriority?: (creep: Creep) => number
  movePriority?: number
}

export type FillAreaStatus = "complete" | "moving"

export function fillAreaWithCreeps(
  roomName: string,
  area: readonly RoomCoordinate[],
  creeps: readonly Creep[],
  options: FillAreaOptions = {},
): FillAreaStatus {
  const areaSet = new Set<number>()
  const creepMatch = new Map<string, number>()
  const posMatch = new Map<number, Creep>()

  const adjacentCreeps: Creep[] = []
  const creepsToTravel: Creep[] = []

  area.forEach((pos) => areaSet.add(toRoomIndex(pos.x, pos.y)))

  creep: for (const creep of creeps) {
    let adjacent: boolean = false

    for (const pos of area) {
      const range = getRange(creep.pos, pos)
      if (range === 0) {
        const index = toRoomIndex(pos.x, pos.y)
        creepMatch.set(creep.name, index)
        posMatch.set(index, creep)
        continue creep
      } else if (range === 1) {
        adjacent = true
      }
    }

    if (adjacent) {
      adjacentCreeps.push(creep)
    } else {
      creepsToTravel.push(creep)
    }
  }

  if (adjacentCreeps.length === 0 && creepsToTravel.length === 0) {
    return "complete"
  }

  if (areaSet.size === creepMatch.size) {
    return "complete"
  }

  if (adjacentCreeps.length > 0) {
    for (const creep of adjacentCreeps) {
      const visited = new Set<string>()
      if (!tryPlaceCreep(creep, areaSet, creepMatch, posMatch, visited)) {
        creepsToTravel.push(creep)
      }
    }
  }

  if (creepsToTravel.length > 0) {
    const goals = area
      .filter((coord) => !posMatch.has(toRoomIndex(coord.x, coord.y)))
      .map((coord) => ({ pos: new RoomPosition(coord.x, coord.y, roomName), range: 1 }))
    for (const creep of creepsToTravel) {
      moveCreep(creep, goals)
    }
  }

  return "moving"
}

function tryPlaceCreep(
  creep: Creep,
  areaSet: Set<number>,
  creepMatch: Map<string, number>,
  posMatch: Map<number, Creep>,
  visited: Set<string>,
): boolean {
  visited.add(creep.name)

  const adjacents = []

  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = creep.pos.x + offset.x
    const neighborY = creep.pos.y + offset.y

    if (!isInsideRoom(creep.pos.x + offset.x, creep.pos.y + offset.y)) {
      continue
    }

    const index = toRoomIndex(neighborX, neighborY)

    if (!areaSet.has(index)) {
      continue
    }

    if (posMatch.has(index)) {
      creepMatch.set(creep.name, index)
      posMatch.set(index, creep)
      return true
    }

    adjacents.push(index)
  }

  for (const index of adjacents) {
    const matchedCreep = posMatch.get(index)
    if (!matchedCreep) {
      continue
    }

    if (!visited.has(matchedCreep.name) && tryPlaceCreep(matchedCreep, areaSet, creepMatch, posMatch, visited)) {
      creepMatch.set(creep.name, index)
      posMatch.set(index, creep)
      return true
    }
  }

  return false
}
