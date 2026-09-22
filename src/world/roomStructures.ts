import { runtimeRegistry } from "../runtime/runtimeRegistry"

interface RoomStructureSignature {
  count: number
  lastId?: string
}

interface RoomStructureCacheEntry {
  signature: RoomStructureSignature
  idsByType: Map<StructureConstant, string[]>
  lastUsed: number
}

interface RoomStructureTemp {
  structures: AnyStructure[]
  byType: Map<StructureConstant, AnyStructure[]>
}

const CACHE_MAX_UNUSED_TICKS = 1000
const CACHE_CLEANUP_INTERVAL = 100

const cache = runtimeRegistry.createCache<string, RoomStructureCacheEntry>("roomStructures", {
  cleanupInterval: CACHE_CLEANUP_INTERVAL,
  cleanup: cleanupRoomStructureCache,
})

let tempTick = -1

const temp = new Map<string, RoomStructureTemp>()

export function getRoomStructures(room: Room): AnyStructure[] {
  return getRoomStructureState(room).temp.structures
}

export function getStructuresByType<T extends StructureConstant>(
  room: Room,
  structureType: T,
): ConcreteStructureMap[T][] {
  const state = getRoomStructureState(room)
  const tempStructures = state.temp.byType.get(structureType)

  if (tempStructures !== undefined) {
    return tempStructures as ConcreteStructureMap[T][]
  }

  const ids = state.cache.idsByType.get(structureType)

  if (ids === undefined) {
    const structures: AnyStructure[] = []
    state.temp.byType.set(structureType, structures)
    return structures as ConcreteStructureMap[T][]
  }

  const structures: AnyStructure[] = []

  for (const id of ids) {
    const structure = Game.getObjectById<AnyStructure>(id)

    if (structure !== null) {
      structures.push(structure)
    }
  }

  state.temp.byType.set(structureType, structures)

  return structures as ConcreteStructureMap[T][]
}

export function invalidateRoomStructureCache(roomName: string): void {
  cache.delete(roomName)
  temp.delete(roomName)
}

function cleanupRoomStructureCache(targetCache: Map<string, RoomStructureCacheEntry>): void {
  for (const [roomName, entry] of targetCache) {
    if (Game.time - entry.lastUsed > CACHE_MAX_UNUSED_TICKS) {
      targetCache.delete(roomName)
    }
  }
}

function getRoomStructureState(room: Room): {
  cache: RoomStructureCacheEntry
  temp: RoomStructureTemp
} {
  prepareTemp()

  const tempEntry = temp.get(room.name)
  const cached = cache.get(room.name)

  if (tempEntry !== undefined && cached !== undefined) {
    cached.lastUsed = Game.time
    return { cache: cached, temp: tempEntry }
  }

  const structures = room.find(FIND_STRUCTURES)
  const signature = createSignature(structures)

  if (cached !== undefined && signaturesEqual(cached.signature, signature)) {
    cached.lastUsed = Game.time

    const newTemp: RoomStructureTemp = {
      structures,
      byType: new Map(),
    }

    temp.set(room.name, newTemp)
    return { cache: cached, temp: newTemp }
  }

  const rebuilt = buildCache(structures, signature)
  cache.set(room.name, rebuilt.cache)
  temp.set(room.name, rebuilt.temp)

  return rebuilt
}

function buildCache(
  structures: AnyStructure[],
  signature: RoomStructureSignature,
): {
  cache: RoomStructureCacheEntry
  temp: RoomStructureTemp
} {
  const idsByType = new Map<StructureConstant, string[]>()
  const byType = new Map<StructureConstant, AnyStructure[]>()

  for (const structure of structures) {
    const structureType = structure.structureType

    let ids = idsByType.get(structureType)
    if (ids === undefined) {
      ids = []
      idsByType.set(structureType, ids)
    }
    ids.push(structure.id)

    let typedStructures = byType.get(structureType)
    if (typedStructures === undefined) {
      typedStructures = []
      byType.set(structureType, typedStructures)
    }
    typedStructures.push(structure)
  }

  return {
    cache: {
      signature,
      idsByType,
      lastUsed: Game.time,
    },
    temp: {
      structures,
      byType,
    },
  }
}

function createSignature(structures: AnyStructure[]): RoomStructureSignature {
  return {
    count: structures.length,
    lastId: structures.length > 0 ? structures[structures.length - 1].id : undefined,
  }
}

function signaturesEqual(a: RoomStructureSignature, b: RoomStructureSignature): boolean {
  return a.count === b.count && a.lastId === b.lastId
}

function prepareTemp(): void {
  if (tempTick === Game.time) {
    return
  }

  tempTick = Game.time
  temp.clear()
}
