import { type RoomCoordinate } from "../../world/map/roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, toRoomIndex } from "../../world/map/roomGrid"
import { moveCreep } from "./movement"
import { registerMove } from "./traffic"

interface FillAreaOptions {
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

  for (const creep of creeps) {
    if (creep.pos.roomName !== roomName) {
      creepsToTravel.push(creep)
      continue
    }

    const currentIndex = toRoomIndex(creep.pos.x, creep.pos.y)

    if (areaSet.has(currentIndex)) {
      creepMatch.set(creep.name, currentIndex)
      posMatch.set(currentIndex, creep)
      continue
    }

    let adjacent = false

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = creep.pos.x + offset.x
      const y = creep.pos.y + offset.y

      if (!isInsideRoom(x, y)) continue

      if (areaSet.has(toRoomIndex(x, y))) {
        adjacent = true
        break
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

    for (const [creepName, index] of creepMatch) {
      const creep = Game.creeps[creepName]
      if (!creep) continue

      const coord = fromRoomIndex(index)

      if (creep.pos.x === coord.x && creep.pos.y === coord.y) {
        continue
      }

      registerMove(creep, new RoomPosition(coord.x, coord.y, roomName), options.movePriority)
    }
  }

  if (creepsToTravel.length > 0) {
    const goals = area
      .filter((coord) => !posMatch.has(toRoomIndex(coord.x, coord.y)))
      .map((coord) => ({ pos: new RoomPosition(coord.x, coord.y, roomName), range: 1 }))
    for (const creep of creepsToTravel) {
      moveCreep(creep, goals, { priority: options.movePriority })
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

    if (!posMatch.has(index)) {
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
