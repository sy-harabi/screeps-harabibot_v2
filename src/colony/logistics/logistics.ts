import { moveCreep } from "../../capabilities/movement/movement"
import { getCreepHeap } from "../../runtime/creepRuntime"
import { getStructuresByType } from "../../world/roomStructures"

export interface LogisticsState {
  readonly suppliers: Map<string, Creep>
  readonly energyRequests: Map<string, EnergyRequest>
}

export interface EnergyRequest {
  readonly id: string
  readonly target: Creep | AnyStoreStructure
  readonly priority: number
  readonly requestedAmount: number

  remainingAmount: number
  softAssignments: number
}

interface LogisticsSupplierRuntime {
  targetRequestId?: string
  committed?: boolean
}

const SPAWN_ENERGY_PRIORITY = 1

const STORAGE_PRIORITY = 100

const COMMIT_RANGE = 5

const SOFT_ASSIGNMENT_PENALTY = 4

export function runLogistics(room: Room, state: LogisticsState): void {
  registerColonyRequests(room, state)

  const unassigned: Creep[] = []

  reconcileAssignments(state, unassigned)

  runAssignedSuppliers(state)
}

function runAssignedSuppliers(state: LogisticsState): void {
  for (const supplier of state.suppliers.values()) {
    const runtime = getCreepHeap<LogisticsSupplierRuntime>(supplier.name)

    const targetId = runtime.targetRequestId

    if (!targetId) {
      continue
    }

    const request = state.energyRequests.get(targetId)

    if (!request) {
      clearAssignment(runtime)
      continue
    }

    if (!supplier.pos.isNearTo(request.target)) {
      moveCreep(supplier, {
        pos: request.target.pos,
        range: 1,
      })
      continue
    }

    const result = supplier.transfer(request.target, RESOURCE_ENERGY)

    if (result === OK) {
      clearAssignment(runtime)
    }
  }
}

function getMatchDistance(supplier: Creep, request: EnergyRequest): number {
  return supplier.pos.getRangeTo(request.target.pos) + request.softAssignments * SOFT_ASSIGNMENT_PENALTY
}

function reconcileAssignments(state: LogisticsState, unassigned: Creep[]): void {
  for (const supplier of state.suppliers.values()) {
    const runtime = getCreepHeap<LogisticsSupplierRuntime>(supplier.name)

    const targetId = runtime.targetRequestId

    if (!targetId) {
      unassigned.push(supplier)
      continue
    }

    const request = state.energyRequests.get(targetId)

    if (!request) {
      clearAssignment(runtime)
      unassigned.push(supplier)
      continue
    }

    const energy = supplier.store.getUsedCapacity(RESOURCE_ENERGY)

    if (energy <= 0) {
      clearAssignment(runtime)
      continue
    }

    if (runtime.committed) {
      const reserved = Math.min(energy, request.remainingAmount)

      if (reserved <= 0) {
        clearAssignment(runtime)
        unassigned.push(supplier)
        continue
      }

      request.remainingAmount -= reserved
      continue
    }

    if (supplier.pos.getRangeTo(request.target.pos) <= COMMIT_RANGE) {
      const reserved = Math.min(energy, request.remainingAmount)

      if (reserved <= 0) {
        clearAssignment(runtime)
        unassigned.push(supplier)
        continue
      }

      runtime.committed = true
      request.remainingAmount -= reserved
      continue
    }

    request.softAssignments++
  }
}

function clearAssignment(runtime: LogisticsSupplierRuntime): void {
  runtime.targetRequestId = undefined
  runtime.committed = false
}

export function createLogisticsState(): LogisticsState {
  return {
    suppliers: new Map(),
    energyRequests: new Map(),
  }
}

function registerColonyRequests(room: Room, state: LogisticsState): void {
  if (room.energyAvailable < room.energyCapacityAvailable) {
    for (const spawn of getStructuresByType(room, STRUCTURE_SPAWN)) {
      if (!spawn.my) {
        continue
      }

      requestEnergy(state, spawn, SPAWN_ENERGY_PRIORITY)
    }

    for (const extension of getStructuresByType(room, STRUCTURE_EXTENSION)) {
      if (!extension.my) {
        continue
      }

      requestEnergy(state, extension, SPAWN_ENERGY_PRIORITY)
    }
  }

  if (room.storage) {
    requestEnergy(state, room.storage, STORAGE_PRIORITY)
  }
}

export function requestEnergy(
  state: LogisticsState,
  target: Creep | AnyStoreStructure,
  priority: number,
  amount = target.store.getFreeCapacity(RESOURCE_ENERGY),
): void {
  if (amount <= 0) {
    return
  }

  state.energyRequests.set(target.id, {
    id: target.id,
    target,
    priority,
    requestedAmount: amount,
    remainingAmount: amount,
    softAssignments: 0,
  })
}

export function registerEnergySupplier(state: LogisticsState, creep: Creep): void {
  if (creep.spawning || creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    return
  }

  state.suppliers.set(creep.name, creep)
}
