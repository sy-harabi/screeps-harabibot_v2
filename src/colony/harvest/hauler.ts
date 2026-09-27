import { moveCreep, moveCreepByPath } from "../../capabilities/movement/movement"
import type { LogisticsState } from "../logistics/logistics"
import { registerEnergySupplier } from "../logistics/logistics"
import type { HarvestSource } from "./harvest"
import { getSourceContainer } from "./harvestSource"

export const HAULER_ROLE = "hauler"

export function runHaulers(
  colonyName: string,
  haulers: readonly Creep[],
  sources: readonly HarvestSource[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSource>,
  logistics: LogisticsState,
): void {
  preparePendingEnergy(sources)

  for (const hauler of haulers) {
    if (hauler.memory.sourceId === undefined || hauler.memory.delivering) {
      continue
    }

    const source = sourceById.get(hauler.memory.sourceId)

    if (source === undefined) {
      continue
    }

    source.pendingEnergy -= hauler.store.getFreeCapacity(RESOURCE_ENERGY)
  }

  for (const hauler of haulers) {
    if (hauler.spawning) {
      continue
    }

    if (hauler.memory.delivering) {
      if (hauler.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        finishDelivery(hauler, sources, sourceById)
        continue
      }

      if (hauler.room.name !== colonyName) {
        moveToColony(colonyName, hauler, sourceById)
        continue
      }

      registerEnergySupplier(logistics, hauler)
      continue
    }

    if (hauler.memory.sourceId === undefined) {
      assignHauler(hauler, sources)
    }

    const sourceId = hauler.memory.sourceId

    if (sourceId === undefined) {
      continue
    }

    const source = sourceById.get(sourceId)

    if (source === undefined) {
      delete hauler.memory.sourceId
      continue
    }

    runFetch(colonyName, hauler, source)
  }
}

function moveToColony(
  colonyName: string,
  hauler: Creep,
  sourceById: ReadonlyMap<Id<Source>, HarvestSource>,
): void {
  const sourceId = hauler.memory.sourceId
  const source = sourceId === undefined ? undefined : sourceById.get(sourceId)

  if (source !== undefined) {
    const result = moveCreepByPath(hauler, source.path, { reverse: true })

    if (result === "pending") {
      return
    }
  }

  moveCreep(
    hauler,
    {
      pos: new RoomPosition(25, 25, colonyName),
      range: 20,
    },
    {
      useRoomRoute: true,
    },
  )
}

function moveToSource(hauler: Creep, source: HarvestSource): void {
  moveCreepByPath(hauler, source.path)
}

function finishDelivery(
  hauler: Creep,
  sources: readonly HarvestSource[],
  sourceById: ReadonlyMap<Id<Source>, HarvestSource>,
): void {
  delete hauler.memory.sourceId
  delete hauler.memory.delivering

  if (!assignHauler(hauler, sources)) {
    return
  }

  const sourceId = hauler.memory.sourceId

  if (sourceId === undefined) {
    return
  }

  const source = sourceById.get(sourceId)

  if (source === undefined) {
    delete hauler.memory.sourceId
    return
  }

  moveToSource(hauler, source)
}

function runFetch(colonyName: string, hauler: Creep, sourceState: HarvestSource): void {
  const path = sourceState.path
  const sourcePos = path[path.length - 1]

  if (sourcePos === undefined) {
    return
  }

  if (hauler.room.name !== sourcePos.roomName || !hauler.pos.inRangeTo(sourcePos, 3)) {
    moveCreepByPath(hauler, path)
    return
  }

  const source = Game.getObjectById(sourceState.id)

  if (source === null) {
    moveCreep(hauler, { pos: sourcePos, range: 1 })
    return
  }

  const droppedEnergy = getDroppedEnergy(source)
  const freeCapacity = hauler.store.getFreeCapacity(RESOURCE_ENERGY)

  if (freeCapacity === 0) {
    startDelivering(colonyName, hauler, sourceState)
    return
  }

  if (droppedEnergy !== undefined) {
    if (!hauler.pos.isNearTo(droppedEnergy)) {
      moveCreep(hauler, {
        pos: droppedEnergy.pos,
        range: 1,
      })
      return
    }

    if (hauler.pickup(droppedEnergy) === OK) {
      if (droppedEnergy.amount >= freeCapacity || source.energy === 0) {
        startDelivering(colonyName, hauler, sourceState)
      }
    }

    return
  }

  const container = getSourceContainer(sourceState.path)

  if (container !== undefined) {
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
        startDelivering(colonyName, hauler, sourceState)
      }

      return
    }
  }

  if (!hauler.pos.inRangeTo(sourcePos, 1)) {
    moveCreep(hauler, { pos: sourcePos, range: 1 })
  }
}

function startDelivering(colonyName: string, hauler: Creep, sourceState: HarvestSource): void {
  hauler.memory.delivering = true

  if (hauler.room.name !== colonyName) {
    moveCreepByPath(hauler, sourceState.path, { reverse: true })
  }
}

function getDroppedEnergy(source: Source): Resource<ResourceConstant> | undefined {
  let result: Resource<ResourceConstant> | undefined

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType !== RESOURCE_ENERGY) {
      continue
    }

    if (result === undefined || resource.amount > result.amount) {
      result = resource
    }
  }

  return result
}

function preparePendingEnergy(sources: readonly HarvestSource[]): void {
  for (const sourceState of sources) {
    const source = Game.getObjectById(sourceState.id)

    if (source === null) {
      sourceState.pendingEnergy = 0
      continue
    }

    sourceState.pendingEnergy = getAvailableEnergy(source, sourceState) + getExpectedEnergyDelta(source, sourceState)
  }
}

function assignHauler(hauler: Creep, sources: readonly HarvestSource[]): boolean {
  const capacity = hauler.store.getCapacity(RESOURCE_ENERGY)

  for (const source of sources) {
    if (source.pendingEnergy < capacity) {
      continue
    }

    const travelTicks = source.path.length

    if (hauler.ticksToLive !== undefined && hauler.ticksToLive <= travelTicks * 2 + 20) {
      continue
    }

    hauler.memory.sourceId = source.id
    source.pendingEnergy -= capacity

    return true
  }

  return false
}

function getExpectedEnergyDelta(source: Source, sourceState: HarvestSource): number {
  const travelTicks = sourceState.path.length
  const regeneration = source.ticksToRegeneration ?? ENERGY_REGEN_TIME

  if (travelTicks < regeneration) {
    return Math.min(source.energy, sourceState.harvestingPower * travelTicks)
  }

  return (
    Math.min(source.energy, sourceState.harvestingPower * regeneration) +
    sourceState.harvestingPower * (travelTicks - regeneration)
  )
}

function getAvailableEnergy(source: Source, sourceState: HarvestSource): number {
  let energy = 0

  for (const resource of source.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
    if (resource.resourceType === RESOURCE_ENERGY) {
      energy += resource.amount
    }
  }

  const container = getSourceContainer(sourceState.path)

  if (container !== undefined) {
    energy += container.store.getUsedCapacity(RESOURCE_ENERGY)
  }

  return energy
}

export function createHaulerBody(room: Room): readonly BodyPartConstant[] | undefined {
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
