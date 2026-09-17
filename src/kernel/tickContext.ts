export interface TickContext {
  readonly tick: number
  readonly ownedRooms: ReadonlyMap<string, Room>
  readonly creepsByOperation: ReadonlyMap<string, CreepsByRole>
}

type CreepsByRole = ReadonlyMap<string, readonly Creep[]>
type MutableCreepsByRole = Map<string, Creep[]>

let currentContext: TickContext | undefined

export function getOperationCreeps(context: TickContext, operationId: string, role: string): readonly Creep[] {
  return context.creepsByOperation.get(operationId)?.get(role) ?? []
}

export function createTickContext(): TickContext {
  const ownedRooms = new Map<string, Room>()

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my === true) {
      ownedRooms.set(room.name, room)
    }
  }

  const creepsByOperation = new Map<string, MutableCreepsByRole>()

  for (const creep of Object.values(Game.creeps)) {
    const { operationId, role } = creep.memory

    if (!operationId || !role) {
      continue
    }

    let creepsByRole = creepsByOperation.get(operationId)

    if (creepsByRole === undefined) {
      creepsByRole = new Map<string, Creep[]>()
      creepsByOperation.set(operationId, creepsByRole)
    }

    let creeps = creepsByRole.get(role)

    if (creeps === undefined) {
      creeps = []
      creepsByRole.set(role, creeps)
    }

    creeps.push(creep)
  }

  const context: TickContext = {
    tick: Game.time,
    ownedRooms,
    creepsByOperation,
  }

  currentContext = context

  return context
}

export function getTickContext(): TickContext {
  if (currentContext === undefined || currentContext.tick !== Game.time) {
    throw new Error("TickContext is not initialized for this tick")
  }

  return currentContext
}
