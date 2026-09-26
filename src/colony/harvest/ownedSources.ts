import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { invalidateHarvestRuntime } from "./harvestRuntime"
import { createSourceData } from "./sourceData"
import { sourceDataStore } from "./sourceDataStore"

export function ensureOwnedSources(room: Room): void {
  if (!sourceDataStore.isReady()) {
    return
  }

  let changed = false

  for (const source of room.find(FIND_SOURCES)) {
    changed = ensureOwnedSource(source) || changed
  }

  if (changed) {
    invalidateHarvestRuntime(room.name)
  }
}

export function findOwnedSourcePath(basePlan: BasePlan, sourceId: Id<Source>): readonly RoomPosition[] | undefined {
  const container = basePlan.structures.find(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.tag?.kind === "source" &&
      structure.tag?.id === sourceId,
  )

  if (container === undefined) {
    return
  }

  return findSourcePath(basePlan, container.coordinate)
}

function ensureOwnedSource(source: Source): boolean {
  const result = sourceDataStore.get(source.id)

  if (result.status === "loading") {
    return false
  }

  if (result.status === "ready" && result.value.roomName === source.room.name) {
    return false
  }

  sourceDataStore.set(
    createSourceData(source.id, source.room.name, {
      x: source.pos.x,
      y: source.pos.y,
    }),
  )

  return true
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
