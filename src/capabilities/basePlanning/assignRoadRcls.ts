import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { fromRoomIndex, isInsideRoom, NEIGHBOR_OFFSETS, ROOM_AREA, toRoomIndex } from "../../world/map/roomGrid"
import type { PlannedStructure } from "./basePlan"

const MIN_CIVIL_ROAD_RCL = 3
const MINERAL_ROAD_RCL = 6
const UNASSIGNED_RCL = 9

export function assignRoadRcls(
  structures: readonly PlannedStructure[],
  coreRoads: readonly RoomCoordinate[],
): PlannedStructure[] {
  const roadMask = buildCivilRoadMask(structures)
  const distance = new Int16Array(ROOM_AREA)
  const parent = new Int16Array(ROOM_AREA)
  const roadRcls = new Uint8Array(ROOM_AREA)
  const queue = new Int16Array(ROOM_AREA)

  distance.fill(-1)
  parent.fill(-1)
  roadRcls.fill(UNASSIGNED_RCL)

  let queueHead = 0
  let queueTail = 0

  for (const { x, y } of coreRoads) {
    const index = toRoomIndex(x, y)

    if (!roadMask[index]) {
      continue
    }

    roadRcls[index] = MIN_CIVIL_ROAD_RCL

    if (distance[index] >= 0) {
      continue
    }

    distance[index] = 0
    parent[index] = index
    queue[queueTail++] = index
  }

  while (queueHead < queueTail) {
    const currentIndex = queue[queueHead++]
    const current = fromRoomIndex(currentIndex)

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = current.x + offset.x
      const y = current.y + offset.y

      if (!isInsideRoom(x, y)) {
        continue
      }

      const nextIndex = toRoomIndex(x, y)

      if (!roadMask[nextIndex] || distance[nextIndex] >= 0) {
        continue
      }

      distance[nextIndex] = distance[currentIndex] + 1
      parent[nextIndex] = currentIndex
      queue[queueTail++] = nextIndex
    }
  }

  for (const structure of structures) {
    if (!isRoadServiceTarget(structure)) {
      continue
    }

    const targetRoadIndex = findClosestReachableRoad(structure.coordinate, roadMask, distance)

    if (targetRoadIndex < 0) {
      continue
    }

    const requiredRcl = getRoadTargetRcl(structure)
    let currentIndex = targetRoadIndex

    while (currentIndex >= 0) {
      roadRcls[currentIndex] = Math.min(roadRcls[currentIndex], requiredRcl)

      const nextIndex = parent[currentIndex]

      if (nextIndex < 0 || nextIndex === currentIndex) {
        break
      }

      currentIndex = nextIndex
    }
  }

  return structures.map((structure) => {
    if (structure.structureType !== STRUCTURE_ROAD || structure.tag?.kind === "rampartBuild") {
      return structure
    }

    const { x, y } = structure.coordinate
    const assignedRcl = roadRcls[toRoomIndex(x, y)]

    return {
      ...structure,
      rcl: assignedRcl === UNASSIGNED_RCL ? Math.max(MIN_CIVIL_ROAD_RCL, structure.rcl) : assignedRcl,
    }
  })
}

function buildCivilRoadMask(structures: readonly PlannedStructure[]): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_ROAD || structure.tag?.kind === "rampartBuild") {
      continue
    }

    const { x, y } = structure.coordinate
    mask[toRoomIndex(x, y)] = 1
  }

  return mask
}

function isRoadServiceTarget(structure: PlannedStructure): boolean {
  return structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_RAMPART
}

function getRoadTargetRcl(structure: PlannedStructure): number {
  switch (structure.tag?.kind) {
    case "source":
      return MIN_CIVIL_ROAD_RCL

    case "mineral":
      return MINERAL_ROAD_RCL

    default:
      return Math.max(MIN_CIVIL_ROAD_RCL, structure.rcl)
  }
}

function findClosestReachableRoad(coordinate: RoomCoordinate, roadMask: Uint8Array, distance: Int16Array): number {
  let bestIndex = -1
  let bestDistance = Infinity

  const consider = (x: number, y: number): void => {
    if (!isInsideRoom(x, y)) {
      return
    }

    const index = toRoomIndex(x, y)
    const candidateDistance = distance[index]

    if (
      !roadMask[index] ||
      candidateDistance < 0 ||
      candidateDistance > bestDistance ||
      (candidateDistance === bestDistance && bestIndex >= 0 && index >= bestIndex)
    ) {
      return
    }

    bestIndex = index
    bestDistance = candidateDistance
  }

  consider(coordinate.x, coordinate.y)

  for (const offset of NEIGHBOR_OFFSETS) {
    consider(coordinate.x + offset.x, coordinate.y + offset.y)
  }

  return bestIndex
}
