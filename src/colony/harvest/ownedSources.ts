import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { createSourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"

export function ensureOwnedSources(room: Room, basePlan: BasePlan): void {
  if (!sourceDataStore.isReady()) {
    return
  }

  for (const source of room.find(FIND_SOURCES)) {
    ensureOwnedSource(source, basePlan)
  }
}

function ensureOwnedSource(source: Source, basePlan: BasePlan): void {
  const result = sourceDataStore.get(source.id)

  if (result.status !== "missing") {
    return
  }

  const container = basePlan.structures.find(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.tag?.kind === "source" &&
      structure.tag?.id === source.id,
  )

  if (!container) {
    return
  }

  const path = findSourcePath(basePlan, container.coordinate)

  if (!path) {
    return
  }

  sourceDataStore.set(
    createSourceData(
      source.id,
      source.room.name,
      {
        x: source.pos.x,
        y: source.pos.y,
      },
      basePlan.roomName,
      path,
    ),
  )
}

function findSourcePath(basePlan: BasePlan, target: RoomCoordinate): RoomPosition[] | undefined {
  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(target.x, target.y, basePlan.roomName),
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

        costs.set(target.x, target.y, 1)

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}
