import { createCreepIntel, type CreepIntel } from "./creepIntel"
import { getIntelMemory } from "./intelMemory"

const SOURCE_KEEPER_USERNAME = "Source Keeper"

export const creepIntelStore = {
  get,
  observe,
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
}
