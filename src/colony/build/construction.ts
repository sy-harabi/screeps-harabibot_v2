import { type BasePlan } from "../../capabilities/basePlanning/basePlan"
import { hasConstructionSiteBudget, tryCreateConstructionSite } from "../../capabilities/construction/constructionSite"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { getRoomStructures, getStructuresByType } from "../../world/roomStructures"

export interface ConstructionState {
  readonly active: boolean
  readonly sites: readonly ConstructionSite[]
}

interface ConstructionCandidate {
  structureType: BuildableStructureConstant
  x: number
  y: number
  priority: number
  bootstrap?: "storageContainer"
}

const MAX_ACTIVE_SITES = 3
const COMPLETE_RECHECK_INTERVAL = 500
const RETRY_INTERVAL = 20

const BUILD_PRIORITY: Partial<Record<BuildableStructureConstant, number>> = {
  [STRUCTURE_SPAWN]: 0,
  [STRUCTURE_TOWER]: 1,
  [STRUCTURE_TERMINAL]: 2,
  [STRUCTURE_STORAGE]: 3,
  [STRUCTURE_EXTENSION]: 4,
  [STRUCTURE_CONTAINER]: 5,
  [STRUCTURE_LINK]: 6,
  [STRUCTURE_ROAD]: 7,
  [STRUCTURE_RAMPART]: 8,
  [STRUCTURE_EXTRACTOR]: 9,
  [STRUCTURE_OBSERVER]: 10,
  [STRUCTURE_LAB]: 11,
  [STRUCTURE_WALL]: 12,
  [STRUCTURE_FACTORY]: 13,
  [STRUCTURE_POWER_SPAWN]: 14,
  [STRUCTURE_NUKER]: 15,
}

interface ConstructionRuntime {
  rcl?: number
  siteIds: Id<ConstructionSite>[]
  hasPendingWork: boolean
  nextCheckTick: number
}

const constructionRuntimes = runtimeRegistry.createCache<string, ConstructionRuntime>("build.construction", {
  cleanupInterval: 500,
  cleanup: (runtimes) => {
    for (const colonyName of runtimes.keys()) {
      if (Game.rooms[colonyName]?.controller?.my !== true) {
        runtimes.delete(colonyName)
      }
    }
  },
})

export function runConstruction(room: Room, basePlan: BasePlan): ConstructionState {
  const controller = room.controller

  if (!controller) {
    return {
      active: false,
      sites: [],
    }
  }

  const runtime = getConstructionRuntime(room.name)

  const sites: ConstructionSite[] = []

  let missingCachedSite = false

  for (const id of runtime.siteIds) {
    const site = Game.getObjectById(id)

    if (site === null) {
      missingCachedSite = true
      continue
    }

    sites.push(site)
  }

  const rclChanged = runtime.rcl !== controller.level

  const shouldReconcile = rclChanged || missingCachedSite || Game.time >= runtime.nextCheckTick

  if (!shouldReconcile) {
    return {
      active: runtime.hasPendingWork,
      sites: sortConstructionSites(room, sites),
    }
  }

  return reconcileConstruction(room, basePlan, runtime)
}

function reconcileConstruction(room: Room, basePlan: BasePlan, runtime: ConstructionRuntime): ConstructionState {
  const controller = room.controller

  if (!controller) {
    return {
      active: false,
      sites: [],
    }
  }

  const sites = room.find(FIND_MY_CONSTRUCTION_SITES)
  const structures = getRoomStructures(room)

  const existingStructures = new Set<string>()

  for (const structure of structures) {
    existingStructures.add(structureKey(structure.pos.x, structure.pos.y, structure.structureType))
  }

  const existingSites = new Set<string>()

  for (const site of sites) {
    existingSites.add(structureKey(site.pos.x, site.pos.y, site.structureType))
  }

  const candidates: ConstructionCandidate[] = []

  const hasSpawn = getStructuresByType(room, STRUCTURE_SPAWN).some((spawn) => spawn.my)

  for (const planned of basePlan.structures) {
    if (planned.rcl > controller.level) {
      continue
    }

    const key = structureKey(planned.coordinate.x, planned.coordinate.y, planned.structureType)

    if (existingStructures.has(key) || existingSites.has(key)) {
      continue
    }

    candidates.push({
      structureType: planned.structureType,
      x: planned.coordinate.x,
      y: planned.coordinate.y,
      priority: getConstructionPriority(room, planned.structureType, hasSpawn),
    })
  }

  if (controller.level < 4) {
    const { x, y } = basePlan.storage

    const containerKey = structureKey(x, y, STRUCTURE_CONTAINER)

    if (!existingStructures.has(containerKey) && !existingSites.has(containerKey)) {
      candidates.push({
        structureType: STRUCTURE_CONTAINER,
        x,
        y,
        priority: getBootstrapStoragePriority(room),
        bootstrap: "storageContainer",
      })
    }
  }

  runtime.hasPendingWork = sites.length > 0 || candidates.length > 0

  if (!runtime.hasPendingWork) {
    runtime.rcl = controller.level
    runtime.siteIds = []
    runtime.nextCheckTick = Game.time + COMPLETE_RECHECK_INTERVAL

    return {
      active: false,
      sites: [],
    }
  }

  candidates.sort((a, b) => {
    return a.priority - b.priority
  })

  let slots = Math.max(0, MAX_ACTIVE_SITES - sites.length)
  let created = 0

  for (const candidate of candidates) {
    if (slots <= 0) {
      break
    }

    if (!hasConstructionSiteBudget()) {
      break
    }

    if (candidate.structureType === STRUCTURE_STORAGE) {
      const bootstrapContainer = getBootstrapStorageContainer(structures, basePlan)

      if (bootstrapContainer !== undefined) {
        const result = bootstrapContainer.destroy()

        runtime.rcl = controller.level
        runtime.siteIds = sites.map((site) => site.id)
        runtime.hasPendingWork = true
        runtime.nextCheckTick = result === OK ? Game.time + 1 : Game.time + RETRY_INTERVAL

        return {
          active: true,
          sites: sortConstructionSites(room, sites),
        }
      }
    }

    const result = tryCreateConstructionSite(room, candidate.x, candidate.y, candidate.structureType)

    if (result === OK) {
      created++
      slots--
    }

    if (result === ERR_FULL) {
      break
    }
  }

  if (created > 0) {
    runtime.nextCheckTick = Game.time + 1
  } else if (candidates.length > 0 && sites.length < MAX_ACTIVE_SITES) {
    runtime.nextCheckTick = Game.time + RETRY_INTERVAL
  } else {
    runtime.nextCheckTick = Game.time + COMPLETE_RECHECK_INTERVAL
  }

  runtime.rcl = controller.level
  runtime.siteIds = sites.map((site) => site.id)
  runtime.hasPendingWork = sites.length > 0 || candidates.length > 0 || created > 0

  return { active: true, sites: sortConstructionSites(room, sites) }
}

function getBootstrapStoragePriority(room: Room): number {
  return room.controller?.level === 1 ? -95 : -70
}

function sortConstructionSites(room: Room, sites: ConstructionSite[]): ConstructionSite[] {
  const hasSpawn = getStructuresByType(room, STRUCTURE_SPAWN).some((spawn) => spawn.my)

  return sites.sort((a, b) => {
    const priorityDifference =
      getConstructionPriority(room, a.structureType, hasSpawn) -
      getConstructionPriority(room, b.structureType, hasSpawn)

    if (priorityDifference !== 0) {
      return priorityDifference
    }

    return b.progress - a.progress
  })
}

function getBootstrapStorageContainer(
  structures: readonly AnyStructure[],
  basePlan: BasePlan,
): StructureContainer | undefined {
  return structures.find(
    (structure): structure is StructureContainer =>
      structure.structureType === STRUCTURE_CONTAINER &&
      structure.pos.x === basePlan.storage.x &&
      structure.pos.y === basePlan.storage.y,
  )
}

function getConstructionPriority(room: Room, structureType: BuildableStructureConstant, hasSpawn: boolean): number {
  if (!hasSpawn && structureType === STRUCTURE_SPAWN) {
    return -100
  }

  if (
    room.energyCapacityAvailable < BODYPART_COST[CLAIM] + BODYPART_COST[MOVE] &&
    structureType === STRUCTURE_EXTENSION
  ) {
    return -90
  }

  if (structureType === STRUCTURE_TOWER) {
    return -80
  }

  if (room.energyCapacityAvailable < 800 && structureType === STRUCTURE_EXTENSION) {
    return -79
  }

  return BUILD_PRIORITY[structureType] ?? 100
}

function structureKey(x: number, y: number, structureType: StructureConstant): string {
  return `${x}:${y}:${structureType}`
}

function getConstructionRuntime(colonyName: string): ConstructionRuntime {
  let runtime = constructionRuntimes.get(colonyName)

  if (runtime === undefined) {
    runtime = {
      siteIds: [],
      hasPendingWork: true,
      nextCheckTick: Game.time,
    }

    constructionRuntimes.set(colonyName, runtime)
  }

  return runtime
}
