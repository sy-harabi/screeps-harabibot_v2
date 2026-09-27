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

export function runReserver(reserver: Creep, roomName: string): void {
  if (reserver.spawning) {
    return
  }

  const intel = intelStore.get(roomName)
  const controllerIntel = intel?.controller

  if (controllerIntel === undefined) {
    return
  }

  const controllerPos = new RoomPosition(controllerIntel.coordinate.x, controllerIntel.coordinate.y, roomName)

  if (!reserver.pos.isNearTo(controllerPos)) {
    moveCreep(
      reserver,
      {
        pos: controllerPos,
        range: 1,
      },
      {
        useRoomRoute: true,
      },
    )
    return
  }

  const controller = Game.getObjectById(controllerIntel.id)

  if (controller === null || controller.owner !== undefined) {
    return
  }

  const reservation = controller.reservation

  if (reservation !== undefined && reservation.username !== reserver.owner.username) {
    reserver.attackController(controller)
    return
  }

  reserver.reserveController(controller)
}
