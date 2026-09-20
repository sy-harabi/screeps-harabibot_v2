import { getOperationCreeps, TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord, SourceState } from "./harvestOperation"

export const HAULER_ROLE = "hauler"

export function runHaulers(
  operation: HarvestOperationRecord,
  context: TickContext,
  sourceOrder: readonly Id<Source>[],
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
  const haulers = getOperationCreeps(context, operation.id, HAULER_ROLE)

  preparePendingEnergy(sourceOrder, sourceStateById)

  for (const hauler of haulers) {
    if (!hauler.memory.sourceId || hauler.memory.delivering) {
      continue
    }

    const sourceId = hauler.memory.sourceId

    const sourceState = sourceStateById.get(sourceId)

    if (!sourceState) {
      continue
    }

    sourceState.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
  }

  for (const hauler of haulers) {
    if (!hauler.memory.sourceId && !hauler.memory.delivering) {
      assignHauler(hauler, sourceOrder, sourceStateById)
    }

    runHauler(hauler, sourceStateById)
  }
}

function runHauler(hauler: Creep, sourceStateById: Map<Id<Source>, SourceState>): void {
  if (hauler.memory.delivering) {
    runDeliver(hauler)
    return
  }

  const sourceId = hauler.memory.sourceId

  if (!sourceId) {
    return
  }

  const sourceState = sourceStateById.get(sourceId)

  if (!sourceState) {
    delete hauler.memory.sourceId
    return
  }

  runFetch(hauler, sourceState)
}

function preparePendingEnergy(sourceOrder: readonly Id<Source>[], sourceStateById: Map<Id<Source>, SourceState>): void {
  for (const sourceId of sourceOrder) {
    const sourceState = sourceStateById.get(sourceId)

    if (!sourceState) {
      continue
    }

    const source = Game.getObjectById(sourceId)

    if (!source) {
      sourceState.pendingEnergy = 0
      continue
    }

    sourceState.pendingEnergy = getAvailableEnergy(source) + getExpectedEnergyDelta(source, sourceState)
  }
}

function assignHauler(
  hauler: Creep,
  sourceOrder: readonly Id<Source>[],
  sourceStateById: Map<Id<Source>, SourceState>,
): boolean {
  const capacity = hauler.store.getCapacity(RESOURCE_ENERGY)

  for (const sourceId of sourceOrder) {
    const sourceState = sourceStateById.get(sourceId)

    if (!sourceState) {
      continue
    }

    if (sourceState.pendingEnergy < capacity) {
      continue
    }

    const travelTicks = sourceState.data.path.length

    if (hauler.ticksToLive !== undefined && hauler.ticksToLive <= travelTicks * 2 + 20) {
      continue
    }

    hauler.memory.sourceId = sourceId
    sourceState.pendingEnergy -= capacity

    return true
  }

  return false
}

function getExpectedEnergyDelta(source: Source, sourceState: SourceState): number {
  const travelTicks = sourceState.data.path.length
  const regeneration = source.ticksToRegeneration ?? ENERGY_REGEN_TIME

  if (travelTicks < regeneration) {
    return Math.min(source.energy, sourceState.harvestingPower * travelTicks)
  }

  return (
    Math.min(source.energy, sourceState.harvestingPower * regeneration) +
    sourceState.harvestingPower * (travelTicks - regeneration)
  )
}

function getAvailableEnergy(source: Source): number {
  let energy = 0

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType === RESOURCE_ENERGY) {
      energy += resource.amount
    }
  }

  // endpoint에 container가 있으면 store energy도 더함

  return energy
}

export function createHaulerBody(roomName: string): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = Math.max(room.energyAvailable, SPAWN_ENERGY_CAPACITY)

  if (budget < 100) {
    return undefined
  }

  const unit = [CARRY, MOVE]

  const unitCost = unit.reduce((prev, curr) => prev + BODYPART_COST[curr], 0)

  const carryCount = Math.min(Math.max(1, Math.floor(budget / unitCost)), Math.floor(MAX_CREEP_SIZE / unit.length))

  const result: BodyPartConstant[] = []

  for (let i = 0; i < carryCount; i++) {
    result.push(...unit)
  }

  return result
}
