import { moveCreep } from "../../capabilities/movement/movement"
import { getStructuresByType } from "../../world/roomStructures"
import { matchEnergySuppliers } from "./logisticsMatcher"
import { getLogisticsSupplierRuntime, type LogisticsSupplierRuntime } from "./logisticsRuntime"

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

export const ENERGY_REQUEST_PRIORITY = {
  spawn: 1,
  tower: 2,
  build: 10,
  upgrade: 20,
  storage: 100,
} as const

const COMMIT_RANGE = 5

const unassignedScratch: Creep[] = []

export function runLogistics(room: Room, state: LogisticsState): void {
  registerColonyRequests(room, state)

  unassignedScratch.length = 0
  reconcileAssignments(state, unassignedScratch)

  matchEnergySuppliers(state.energyRequests, unassignedScratch)
  commitMatchedAssignments(state, unassignedScratch)

  runAssignedSuppliers(state)
}

function reconcileAssignments(state: LogisticsState, unassigned: Creep[]): void {
  for (const supplier of state.suppliers.values()) {
    const runtime = getLogisticsSupplierRuntime(supplier.name)

    if (!runtime.committed) {
      continue
    }

    const targetId = runtime.targetRequestId
    const request = targetId ? state.energyRequests.get(targetId) : undefined
    const energy = supplier.store.getUsedCapacity(RESOURCE_ENERGY)

    if (!request || energy <= 0) {
      clearAssignment(runtime)
      continue
    }

    const reserved = Math.min(energy, request.remainingAmount)

    if (reserved <= 0) {
      clearAssignment(runtime)
      continue
    }

    request.remainingAmount -= reserved
  }

  for (const supplier of state.suppliers.values()) {
    const runtime = getLogisticsSupplierRuntime(supplier.name)

    if (runtime.committed) {
      continue
    }

    const energy = supplier.store.getUsedCapacity(RESOURCE_ENERGY)

    if (energy <= 0) {
      clearAssignment(runtime)
      continue
    }

    const targetId = runtime.targetRequestId

    if (!targetId) {
      unassigned.push(supplier)
      continue
    }

    const request = state.energyRequests.get(targetId)

    if (!request || request.remainingAmount <= 0) {
      clearAssignment(runtime)
      unassigned.push(supplier)
      continue
    }

    if (
      supplier.pos.roomName === request.target.pos.roomName &&
      supplier.pos.getRangeTo(request.target.pos) <= COMMIT_RANGE
    ) {
      runtime.committed = true
      request.remainingAmount -= Math.min(energy, request.remainingAmount)
      continue
    }

    request.softAssignments++
  }
}

function commitMatchedAssignments(state: LogisticsState, suppliers: readonly Creep[]): void {
  for (const supplier of suppliers) {
    const runtime = getLogisticsSupplierRuntime(supplier.name)

    if (runtime.committed || !runtime.targetRequestId) {
      continue
    }

    const request = state.energyRequests.get(runtime.targetRequestId)

    if (!request || request.remainingAmount <= 0) {
      clearAssignment(runtime)
      continue
    }

    if (
      supplier.pos.roomName !== request.target.pos.roomName ||
      supplier.pos.getRangeTo(request.target.pos) > COMMIT_RANGE
    ) {
      continue
    }

    const energy = supplier.store.getUsedCapacity(RESOURCE_ENERGY)
    const reserved = Math.min(energy, request.remainingAmount)

    if (reserved <= 0) {
      clearAssignment(runtime)
      continue
    }

    runtime.committed = true
    request.remainingAmount -= reserved
  }
}

function runAssignedSuppliers(state: LogisticsState): void {
  for (const supplier of state.suppliers.values()) {
    const runtime = getLogisticsSupplierRuntime(supplier.name)
    const targetId = runtime.targetRequestId

    if (!targetId) {
      continue
    }

    const request = state.energyRequests.get(targetId)

    if (!request) {
      clearAssignment(runtime)
      continue
    }

    if (!runtime.committed && request.remainingAmount <= 0) {
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

      requestEnergy(state, spawn, ENERGY_REQUEST_PRIORITY.spawn)
    }

    for (const extension of getStructuresByType(room, STRUCTURE_EXTENSION)) {
      if (!extension.my) {
        continue
      }

      requestEnergy(state, extension, ENERGY_REQUEST_PRIORITY.spawn)
    }
  }

  if (room.storage) {
    requestEnergy(state, room.storage, ENERGY_REQUEST_PRIORITY.storage)
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
