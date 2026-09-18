import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { getRoomStructures } from "../../world/roomStructures"

interface RoomCostMatrixSignature {
  structureCount: number
  lastStructureId?: string
  constructionSiteCount: number
  lastConstructionSiteId?: string
}

interface RoomCostMatrixCacheEntry {
  matrix?: CostMatrix
  signature: RoomCostMatrixSignature
  lastUsed: number
}

const CACHE_MAX_UNUSED_TICKS = 1000
const CACHE_CLEANUP_INTERVAL = 100

const obstacleObjectTypes = new Set<string>(OBSTACLE_OBJECT_TYPES)

const cache = runtimeRegistry.createCache<string, RoomCostMatrixCacheEntry>("roomCostMatrix")

let tempTick = -1
let lastCleanupTick = -Infinity

const temp = new Map<string, CostMatrix | undefined>()

export function getRoomCostMatrix(roomName: string): CostMatrix | undefined {
  prepareTemp()
  cleanupRoomCostMatrixCache()

  if (temp.has(roomName)) {
    return temp.get(roomName)
  }

  const cached = cache.get(roomName)
  const room = Game.rooms[roomName]

  if (room === undefined) {
    if (cached !== undefined) {
      cached.lastUsed = Game.time
      temp.set(roomName, cached.matrix)
      return cached.matrix
    }

    temp.set(roomName, undefined)
    return undefined
  }

  const structures = getRoomStructures(room)
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES)

  const signature = createSignature(structures, constructionSites)

  if (cached !== undefined && signaturesEqual(cached.signature, signature)) {
    cached.lastUsed = Game.time
    temp.set(roomName, cached.matrix)
    return cached.matrix
  }

  const matrix = buildRoomCostMatrix(structures, constructionSites)

  cache.set(roomName, {
    matrix,
    signature,
    lastUsed: Game.time,
  })

  temp.set(roomName, matrix)

  return matrix
}

function buildRoomCostMatrix(
  structures: AnyStructure[],
  constructionSites: ConstructionSite[],
): CostMatrix | undefined {
  if (structures.length === 0 && constructionSites.length === 0) {
    return undefined
  }

  const matrix = new PathFinder.CostMatrix()

  for (const structure of structures) {
    if (isBlockingStructure(structure)) {
      matrix.set(structure.pos.x, structure.pos.y, 255)
    }
  }

  for (const site of constructionSites) {
    if (obstacleObjectTypes.has(site.structureType)) {
      matrix.set(site.pos.x, site.pos.y, 255)
    }
  }

  for (const structure of structures) {
    if (structure.structureType === STRUCTURE_ROAD && matrix.get(structure.pos.x, structure.pos.y) !== 255) {
      matrix.set(structure.pos.x, structure.pos.y, 1)
    }
  }

  return matrix
}

function isBlockingStructure(structure: AnyStructure): boolean {
  if (structure.structureType === STRUCTURE_RAMPART) {
    return !structure.my && !structure.isPublic
  }

  return obstacleObjectTypes.has(structure.structureType)
}

function signaturesEqual(a: RoomCostMatrixSignature, b: RoomCostMatrixSignature): boolean {
  return (
    a.structureCount === b.structureCount &&
    a.lastStructureId === b.lastStructureId &&
    a.constructionSiteCount === b.constructionSiteCount &&
    a.lastConstructionSiteId === b.lastConstructionSiteId
  )
}

function createSignature(structures: AnyStructure[], constructionSites: ConstructionSite[]): RoomCostMatrixSignature {
  return {
    structureCount: structures.length,
    lastStructureId: structures.length > 0 ? structures[structures.length - 1].id : undefined,
    constructionSiteCount: constructionSites.length,
    lastConstructionSiteId:
      constructionSites.length > 0 ? constructionSites[constructionSites.length - 1].id : undefined,
  }
}

export function invalidateRoomCostMatrix(roomName: string): void {
  cache.delete(roomName)
  temp.delete(roomName)
}

export function cleanupRoomCostMatrixCache(): void {
  if (Game.time - lastCleanupTick < CACHE_CLEANUP_INTERVAL) {
    return
  }

  lastCleanupTick = Game.time

  for (const [roomName, entry] of cache) {
    if (Game.time - entry.lastUsed > CACHE_MAX_UNUSED_TICKS) {
      cache.delete(roomName)
    }
  }
}

function prepareTemp(): void {
  if (tempTick === Game.time) {
    return
  }

  tempTick = Game.time
  temp.clear()
}
