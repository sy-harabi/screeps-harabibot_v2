import { moveCreep } from "../../capabilities/movement/movement"
import { getOperationCreeps, TickContext } from "../../kernel/tickContext"
import type { HarvestOperationRecord, SourceState } from "./harvestOperation"

export const HAULER_ROLE = "hauler"

type DeliveryTarget = StructureSpawn | StructureExtension | StructureStorage

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

    runHauler(hauler, sourceOrder, sourceStateById)
  }
}

function runHauler(
  hauler: Creep,
  sourceOrder: readonly Id<Source>[],
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
  const sourceId = hauler.memory.sourceId

  if (!sourceId) {
    return
  }

  const sourceState = sourceStateById.get(sourceId)

  if (!sourceState) {
    delete hauler.memory.sourceId
    delete hauler.memory.delivering
    return
  }

  if (hauler.memory.delivering) {
    runDeliver(hauler, sourceState, sourceOrder, sourceStateById)
    return
  }

  runFetch(hauler, sourceState)
}

function runDeliver(
  hauler: Creep,
  sourceState: SourceState,
  sourceOrder: readonly Id<Source>[],
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
  const energy = hauler.store.getUsedCapacity(RESOURCE_ENERGY)

  if (energy === 0) {
    finishDelivery(hauler, sourceOrder, sourceStateById)
    return
  }

  const room = Game.rooms[sourceState.data.colonyRoomName]

  if (!room) {
    moveToColony(hauler, sourceState)
    return
  }

  const target = findDeliveryTarget(hauler, room)

  if (!target) {
    return
  }

  if (!hauler.pos.isNearTo(target)) {
    moveCreep(hauler, {
      pos: target.pos,
      range: 1,
    })
    return
  }

  const freeCapacity = target.store.getFreeCapacity(RESOURCE_ENERGY)

  if (hauler.transfer(target, RESOURCE_ENERGY) !== OK) {
    return
  }

  if (freeCapacity >= energy) {
    finishDelivery(hauler, sourceOrder, sourceStateById)
  }
}

function moveToColony(hauler: Creep, sourceState: SourceState): void {
  const returnPos = sourceState.data.path[0]

  if (!returnPos) {
    return
  }

  moveCreep(hauler, {
    pos: returnPos,
    range: 0,
  })
}

function moveToSource(hauler: Creep, sourceState: SourceState): void {
  const sourcePos = sourceState.data.path[sourceState.data.path.length - 1]

  if (!sourcePos) {
    return
  }

  moveCreep(hauler, {
    pos: sourcePos,
    range: 1,
  })
}

function finishDelivery(
  hauler: Creep,
  sourceOrder: readonly Id<Source>[],
  sourceStateById: Map<Id<Source>, SourceState>,
): void {
  delete hauler.memory.sourceId
  delete hauler.memory.delivering

  if (!assignHauler(hauler, sourceOrder, sourceStateById)) {
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

  moveToSource(hauler, sourceState)
}

function findDeliveryTarget(hauler: Creep, room: Room): DeliveryTarget | undefined {
  const energyStructures = room.find(FIND_MY_STRUCTURES, {
    filter: (structure): structure is StructureSpawn | StructureExtension =>
      (structure.structureType === STRUCTURE_SPAWN || structure.structureType === STRUCTURE_EXTENSION) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  })

  const target = hauler.pos.findClosestByRange(energyStructures)

  if (target) {
    return target
  }

  if (room.storage && room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return room.storage
  }

  return
}

function runFetch(hauler: Creep, sourceState: SourceState): void {
  const source = Game.getObjectById(sourceState.data.sourceId)
  const sourcePos = sourceState.data.path[sourceState.data.path.length - 1]

  if (!source) {
    moveCreep(hauler, { pos: sourcePos, range: 1 })
    return
  }

  const droppedEnergy = getDroppedEnergy(source)

  const freeCapacity = hauler.store.getFreeCapacity(RESOURCE_ENERGY)

  if (freeCapacity === 0) {
    startDelivering(hauler, sourceState)
    return
  }

  if (droppedEnergy) {
    if (!hauler.pos.isNearTo(droppedEnergy)) {
      moveCreep(hauler, {
        pos: droppedEnergy.pos,
        range: 1,
      })
      return
    }

    if (hauler.pickup(droppedEnergy) === OK) {
      if (droppedEnergy.amount >= freeCapacity || source.energy === 0) {
        startDelivering(hauler, sourceState)
      }
    }

    return
  }

  const container = getSourceContainer(sourceState)

  if (container) {
    if (!hauler.pos.isNearTo(container)) {
      moveCreep(hauler, {
        pos: container.pos,
        range: 1,
      })
      return
    }

    const amount = container.store.getUsedCapacity(RESOURCE_ENERGY)

    if (amount >= freeCapacity || (amount > 0 && source.energy === 0)) {
      if (hauler.withdraw(container, RESOURCE_ENERGY) === OK) {
        startDelivering(hauler, sourceState)
      }

      return
    }
  }

  // The source is still producing. Wait near the pickup position.
  if (!hauler.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(hauler, { pos: sourcePos, range: 1 })
  }
}

function startDelivering(hauler: Creep, sourceState: SourceState): void {
  hauler.memory.delivering = true

  const returnPos = sourceState.data.path[0]

  if (!returnPos) {
    return
  }

  moveCreep(hauler, {
    pos: returnPos,
    range: 0,
  })
}

function getSourceContainer(sourceState: SourceState): StructureContainer | undefined {
  const pos = sourceState.data.path[sourceState.data.path.length - 1]

  if (!pos || !Game.rooms[pos.roomName]) {
    return
  }

  return pos
    .lookFor(LOOK_STRUCTURES)
    .find((structure): structure is StructureContainer => structure.structureType === STRUCTURE_CONTAINER)
}

function getDroppedEnergy(source: Source): Resource<ResourceConstant> | undefined {
  let result: Resource<ResourceConstant> | undefined

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType !== RESOURCE_ENERGY) {
      continue
    }

    if (!result || resource.amount > result.amount) {
      result = resource
    }
  }

  return result
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

    sourceState.pendingEnergy = getAvailableEnergy(source, sourceState) + getExpectedEnergyDelta(source, sourceState)
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

function getAvailableEnergy(source: Source, sourceState: SourceState): number {
  let energy = 0

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType === RESOURCE_ENERGY) {
      energy += resource.amount
    }
  }

  const container = getSourceContainer(sourceState)

  if (container) {
    energy += container.store.getUsedCapacity(RESOURCE_ENERGY)
  }
  return energy
}

export function createHaulerBody(roomName: string): readonly BodyPartConstant[] | undefined {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const budget = room.energyAvailable

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
