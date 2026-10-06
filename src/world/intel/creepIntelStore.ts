import { createCreepIntel, type CreepIntel } from "./creepIntel"
import { getIntelMemory } from "./intelMemory"

const SOURCE_KEEPER_USERNAME = "Source Keeper"

const CREEP_INTEL_STALE_TICKS = 300

let roomIndexTick = -1

const creepIdsByRoom = new Map<string, Id<Creep>[]>()

function getForeignCreepIds(roomName: string): readonly Id<Creep>[] {
  prepareRoomIndex()

  return creepIdsByRoom.get(roomName) ?? []
}

function prepareRoomIndex(): void {
  if (roomIndexTick === Game.time) {
    return
  }

  roomIndexTick = Game.time
  creepIdsByRoom.clear()

  const creeps = getIntelMemory().creeps

  for (const id in creeps) {
    const creepId = id as Id<Creep>
    const intel = creeps[creepId]

    if (!isValidCreepIntel(intel)) {
      delete creeps[creepId]
      continue
    }

    let ids = creepIdsByRoom.get(intel.lastSeenRoomName)

    if (ids === undefined) {
      ids = []
      creepIdsByRoom.set(intel.lastSeenRoomName, ids)
    }

    ids.push(creepId)
  }
}

export const creepIntelStore = {
  get,
  observe,
  getForeignCreepIds,
}

function get(id: Id<Creep>): CreepIntel | undefined {
  return getIntelMemory().creeps[id]
}

function observe(room: Room): void {
  const creeps = getIntelMemory().creeps

  for (const creep of room.find(FIND_HOSTILE_CREEPS)) {
    if (creep.owner.username === SOURCE_KEEPER_USERNAME) {
      continue
    }

    creeps[creep.id] = createCreepIntel(creep)
  }

  roomIndexTick = -1
}

function isValidCreepIntel(intel: CreepIntel): boolean {
  if (intel.ttlExpiresAt !== undefined && Game.time >= intel.ttlExpiresAt) {
    return false
  }

  return Game.time <= intel.lastSeen + CREEP_INTEL_STALE_TICKS
}
