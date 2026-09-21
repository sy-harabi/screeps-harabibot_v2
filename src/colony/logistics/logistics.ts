import { moveCreep } from "../../capabilities/movement/movement"
import { getStructuresByType } from "../../world/roomStructures"

export interface LogisticsState {
  readonly suppliers: Creep[]
  readonly energyRequests: EnergyRequest[]
}

export interface EnergyRequest {
  readonly target: Creep | AnyStoreStructure
  readonly priority: number
  remainingAmount: number
}

const SPAWN_ENERGY_PRIORITY = 1

const STORAGE_PRIORITY = 100

export function runLogistics(room: Room, state: LogisticsState): void {
  registerColonyRequests(room, state)

  state.energyRequests.sort((a, b) => a.priority - b.priority)

  for (const supplier of state.suppliers) {
    const request = findBestRequest(supplier, state.energyRequests)

    if (!request) {
      continue
    }

    const amount = Math.min(supplier.store.getUsedCapacity(RESOURCE_ENERGY), request.remainingAmount)

    request.remainingAmount -= amount

    runSupplier(supplier, request.target)
  }
}

function runSupplier(supplier: Creep, target: Creep | AnyStoreStructure): void {
  if (!supplier.pos.isNearTo(target)) {
    moveCreep(supplier, {
      pos: target.pos,
      range: 1,
    })

    return
  }

  supplier.transfer(target, RESOURCE_ENERGY)
}

function findBestRequest(supplier: Creep, requests: readonly EnergyRequest[]): EnergyRequest | undefined {
  let best: EnergyRequest | undefined
  let bestDistance = Infinity

  for (const request of requests) {
    if (request.remainingAmount <= 0) {
      continue
    }

    if (best && request.priority > best.priority) {
      break
    }

    const distance = supplier.pos.getRangeTo(request.target.pos)

    if (!best || distance < bestDistance) {
      best = request
      bestDistance = distance
    }
  }

  return best
}

export function createLogisticsState(): LogisticsState {
  return {
    suppliers: [],
    energyRequests: [],
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

  state.energyRequests.push({
    target,
    priority,
    remainingAmount: amount,
  })
}

export function registerEnergySupplier(state: LogisticsState, creep: Creep): void {
  if (creep.spawning) {
    return
  }

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    return
  }

  state.suppliers.push(creep)
}
