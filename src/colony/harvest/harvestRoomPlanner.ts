import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { intelStore } from "../../world/intel/intelStore"
import { type SourceIntel } from "../../world/intel/roomIntel"
import { harvestRoomDataStore } from "./harvestDataStore"
import { type HarvestSourceData, type HarvestRoomData } from "./harvestRoomData"

export function ensureHarvestRoomData(
  roomName: string,
  colonyName: string,
  basePlan: BasePlan,
): HarvestRoomData | undefined {
  if (!harvestRoomDataStore.isReady()) {
    return
  }

  const existing = harvestRoomDataStore.get(roomName)

  if (existing !== undefined && existing.colonyName === colonyName && existing.basePlanRevision === basePlan.revision) {
    return existing
  }

  const intel = intelStore.get(roomName)

  if (intel === undefined) {
    return
  }

  const sources = planHarvestSourcePaths(roomName, colonyName, basePlan, intel.sources)

  if (sources === undefined) {
    return
  }

  sources.sort((a, b) => a.path.length - b.path.length || a.sourceId.localeCompare(b.sourceId))

  const data: HarvestRoomData = {
    colonyName,
    basePlanRevision: basePlan.revision,
    sources,
  }

  harvestRoomDataStore.set(roomName, data)

  return data
}

function planHarvestSourcePaths(
  roomName: string,
  colonyName: string,
  basePlan: BasePlan,
  sources: readonly SourceIntel[],
): HarvestSourceData[] | undefined {
  if (roomName === colonyName) {
    return planOwnedSourcePaths(basePlan, sources)
  }

  //planRemoteSourcePaths

  return
}

function planOwnedSourcePaths(basePlan: BasePlan, sources: readonly SourceIntel[]): HarvestSourceData[] | undefined {
  const result: HarvestSourceData[] = []

  for (const source of sources) {
    const path = findOwnedSourcePath(source, basePlan)

    if (path === undefined) {
      return
    }

    result.push({
      sourceId: source.id,
      path,
    })
  }

  return result
}

function findOwnedSourcePath(source: SourceIntel, basePlan: BasePlan): RoomPosition[] | undefined {
  const container = basePlan.structures.find(
    (structure) =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.tag?.kind === "source" &&
      structure.tag?.id === source.id,
  )

  if (!container) {
    return
  }

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(container.coordinate.x, container.coordinate.y, basePlan.roomName),
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

        costs.set(container.coordinate.x, container.coordinate.y, 1)

        return costs
      },
    },
  )

  if (result.incomplete) {
    return
  }

  return result.path
}
