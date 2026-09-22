import { moveCreep } from "../../capabilities/movement/movement"
import { setWorkingArea } from "../../capabilities/movement/traffic"
import { requestEnergy, type LogisticsState } from "../logistics/logistics"

export const BUILDER_ROLE = "builder"

const BUILD_ENERGY_PRIORITY = 10

export function createBuilderBody(room: Room, targetWork: number): readonly BodyPartConstant[] | undefined {
  const budget = room.energyCapacityAvailable
  const unitCost = BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE]

  const units = Math.min(targetWork, Math.floor(budget / unitCost), Math.floor(MAX_CREEP_SIZE / 3))

  if (units <= 0) {
    return
  }

  return [
    ...Array<BodyPartConstant>(units).fill(WORK),
    ...Array<BodyPartConstant>(units).fill(CARRY),
    ...Array<BodyPartConstant>(units).fill(MOVE),
  ]
}

export function runBuilder(
  room: Room,
  creep: Creep,
  logistics: LogisticsState,
  sites: readonly ConstructionSite[],
): void {
  const target = sites[0]

  if (!target) {
    return
  }

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    runBuilderEnergy(room, creep, logistics, target)
    return
  }

  if (creep.pos.getRangeTo(target) > 3) {
    moveCreep(creep, {
      pos: target.pos,
      range: 3,
    })
    return
  }

  creep.build(target)
  setWorkingArea(creep, target.pos, 3)
}

function runBuilderEnergy(room: Room, creep: Creep, logistics: LogisticsState, target: ConstructionSite): void {
  if (!room.storage) {
    requestEnergy(logistics, creep, BUILD_ENERGY_PRIORITY)

    if (creep.pos.getRangeTo(target) > 3) {
      moveCreep(creep, {
        pos: target.pos,
        range: 3,
      })
    }

    return
  }

  if (!creep.pos.isNearTo(room.storage)) {
    moveCreep(creep, {
      pos: room.storage.pos,
      range: 1,
    })
    return
  }

  creep.withdraw(room.storage, RESOURCE_ENERGY)
}
