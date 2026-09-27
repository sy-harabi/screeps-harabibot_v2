import { moveCreep } from "../../capabilities/movement/movement"
import { intelStore } from "../../world/intel/intelStore"

export const RESERVER_ROLE = "reserver"

export function createReserverBody(room: Room): readonly BodyPartConstant[] | undefined {
  if (room.energyCapacityAvailable < 650) {
    return
  }

  if (room.energyCapacityAvailable < 1300) {
    return [CLAIM, MOVE]
  }

  return [CLAIM, CLAIM, MOVE, MOVE]
}

export function runReserver(reserver: Creep, roomName: string) {
  if (reserver.spawning) {
    return
  }

  const intel = intelStore.get(roomName)

  if (intel === undefined) {
    return
  }

  const controllerCoordinate = intel.controller?.coordinate

  if (controllerCoordinate === undefined) {
    return
  }

  if (
    reserver.pos.roomName !== roomName ||
    reserver.pos.getRangeTo(controllerCoordinate.x, controllerCoordinate.y) > 1
  ) {
    moveCreep(reserver, { pos: new RoomPosition(controllerCoordinate.x, controllerCoordinate.y, roomName), range: 1 })
    return
  }

  const controller = Game.rooms[roomName]?.controller

  if (controller === undefined) {
    return
  }

  if (reserver.reserveController(controller) !== OK) {
    reserver.attackController(controller)
  }
}
