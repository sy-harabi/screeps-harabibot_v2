export interface ColonyEnergyState {
  readonly storage: number
  readonly terminal: number
  readonly total: number
}

export interface TickContext {
  readonly tick: number
  readonly ownedRooms: ReadonlyMap<string, Room>
  readonly energyByColony: ReadonlyMap<string, ColonyEnergyState>
  readonly creepsByColony: ReadonlyMap<string, CreepsByRole>
  readonly creepsByMission: ReadonlyMap<string, CreepsByRole>
}

type CreepsByRole = ReadonlyMap<string, readonly Creep[]>
type MutableCreepsByRole = Map<string, Creep[]>

let currentContext: TickContext | undefined

export function getColonyCreeps(context: TickContext, colonyName: string, role: string): readonly Creep[] {
  return context.creepsByColony.get(colonyName)?.get(role) ?? []
}

export function getMissionCreeps(context: TickContext, missionId: string, role: string): readonly Creep[] {
  return context.creepsByMission.get(missionId)?.get(role) ?? []
}

export function getColonyEnergyState(context: TickContext, colonyName: string): ColonyEnergyState {
  const energy = context.energyByColony.get(colonyName)

  if (energy === undefined) {
    throw new Error(`Colony energy state is not available for ${colonyName}`)
  }

  return energy
}

export function createTickContext(): TickContext {
  const ownedRooms = new Map<string, Room>()
  const energyByColony = new Map<string, ColonyEnergyState>()

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my === true) {
      ownedRooms.set(room.name, room)
      energyByColony.set(room.name, createColonyEnergyState(room))
    }
  }

  const creepsByColony = new Map<string, MutableCreepsByRole>()
  const creepsByMission = new Map<string, MutableCreepsByRole>()

  for (const creep of Object.values(Game.creeps)) {
    const { assignment, role } = creep.memory

    switch (assignment.type) {
      case "colony":
        addCreep(creepsByColony, assignment.colonyName, role, creep)
        break

      case "mission":
        addCreep(creepsByMission, assignment.missionId, role, creep)
        break
    }
  }

  const context: TickContext = {
    tick: Game.time,
    ownedRooms,
    energyByColony,
    creepsByColony,
    creepsByMission,
  }

  currentContext = context

  return context
}

function createColonyEnergyState(room: Room): ColonyEnergyState {
  const storage = room.storage?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0
  const terminal = room.terminal?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0

  return {
    storage,
    terminal,
    total: storage + terminal,
  }
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
