export interface TickContext {
  readonly tick: number

  readonly ownedRooms: ReadonlyMap<string, Room>

  readonly creepsByColony: ReadonlyMap<string, CreepsByRole>
  readonly creepsByMission: ReadonlyMap<string, CreepsByRole>
}

type CreepsByRole = ReadonlyMap<string, readonly Creep[]>
type MutableCreepsByRole = Map<string, Creep[]>

let currentContext: TickContext | undefined

export function createTickContext(): TickContext {
  const ownedRooms = new Map<string, Room>()

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my === true) {
      ownedRooms.set(room.name, room)
    }
  }

  const creepsByColony = new Map<string, MutableCreepsByRole>()
  const creepsByMission = new Map<string, MutableCreepsByRole>()

  for (const creep of Object.values(Game.creeps)) {
    const assignment = creep.memory.assignment

    if (!assignment) {
      continue
    }

    switch (assignment.type) {
      case "colony":
        addCreep(creepsByColony, assignment.colonyName, creep.memory.role, creep)
        break

      case "mission":
        addCreep(creepsByMission, assignment.missionId, creep.memory.role, creep)
        break
    }
  }

  const context: TickContext = {
    tick: Game.time,
    ownedRooms,
    creepsByColony,
    creepsByMission,
  }

  currentContext = context

  return context
}

function addCreep(index: Map<string, MutableCreepsByRole>, id: string, role: string, creep: Creep): void {
  let creepsByRole = index.get(id)

  if (creepsByRole === undefined) {
    creepsByRole = new Map()
    index.set(id, creepsByRole)
  }

  let creeps = creepsByRole.get(role)

  if (creeps === undefined) {
    creeps = []
    creepsByRole.set(role, creeps)
  }

  creeps.push(creep)
}

export function getTickContext(): TickContext {
  if (currentContext === undefined || currentContext.tick !== Game.time) {
    throw new Error("TickContext is not initialized for this tick")
  }

  return currentContext
}
