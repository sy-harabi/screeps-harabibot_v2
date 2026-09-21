import type { CreepAssignment } from "../../creeps/creepAssignment"
import { getTickContext } from "../../kernel/tickContext"
import type { SpawnPriorityType } from "./spawnPriority"
import type { RenewRequest, SpawnRequest } from "./spawnRequest"

export type SpawnBody = readonly BodyPartConstant[] | (() => readonly BodyPartConstant[] | undefined)

export interface SpawnRequestContext {
  readonly requesterId: string
  readonly spawnRoomName: string
  readonly assignment: CreepAssignment
  readonly priorityType: SpawnPriorityType
  readonly order: number
  readonly rolesByPriority: readonly string[]
}

export interface SpawnRoomState {
  readonly freeSpawns: readonly StructureSpawn[]
  readonly spawnRequests: SpawnRequest[]
  readonly renewRequests: RenewRequest[]
}

const roomStates = new Map<string, SpawnRoomState>()

let stateTick: number | undefined

export function getSpawnRoomStates(): ReadonlyMap<string, SpawnRoomState> {
  prepareState()
  return roomStates
}

export function requestSpawn(
  context: SpawnRequestContext,
  body: SpawnBody,
  role: string,
  options: {
    memory?: Partial<Omit<CreepMemory, "assignment" | "role">>
  } = {},
): void {
  const roleOrder = getRoleOrder(context, role)
  const state = getSpawnRoomState(context.spawnRoomName)

  if (state === undefined || state.freeSpawns.length === 0) {
    return
  }

  const resolvedBody = typeof body === "function" ? body() : body

  if (resolvedBody === undefined || resolvedBody.length === 0) {
    return
  }

  state.spawnRequests.push({
    requesterId: context.requesterId,
    spawnRoomName: context.spawnRoomName,
    role,
    body: resolvedBody,
    priority: {
      type: context.priorityType,
      order: context.order,
      roleOrder,
    },
    memory: {
      ...options.memory,
      assignment: context.assignment,
      role,
    },
  })
}

export function requestRenew(context: SpawnRequestContext, creepName: string, role: string): void {
  const roleOrder = getRoleOrder(context, role)
  const state = getSpawnRoomState(context.spawnRoomName)

  if (state === undefined || state.freeSpawns.length === 0) {
    return
  }

  state.renewRequests.push({
    requesterId: context.requesterId,
    creepName,
    spawnRoomName: context.spawnRoomName,
    priority: {
      type: context.priorityType,
      order: context.order,
      roleOrder,
    },
  })
}

function getRoleOrder(context: SpawnRequestContext, role: string): number {
  const roleOrder = context.rolesByPriority.indexOf(role)

  if (roleOrder === -1) {
    throw new Error(`Role ${role} is not registered for spawn requester ${context.requesterId}`)
  }

  return roleOrder
}

function getSpawnRoomState(spawnRoomName: string): SpawnRoomState | undefined {
  prepareState()

  const existing = roomStates.get(spawnRoomName)

  if (existing !== undefined) {
    return existing
  }

  const context = getTickContext()
  const room = context.ownedRooms.get(spawnRoomName)

  if (room === undefined) {
    return undefined
  }

  const state: SpawnRoomState = {
    freeSpawns: room.find(FIND_MY_SPAWNS).filter((spawn) => spawn.isActive() && !spawn.spawning),
    spawnRequests: [],
    renewRequests: [],
  }

  roomStates.set(spawnRoomName, state)

  return state
}

function prepareState(): void {
  if (stateTick === Game.time) {
    return
  }

  roomStates.clear()
  stateTick = Game.time
}
