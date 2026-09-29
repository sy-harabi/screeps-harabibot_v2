import { getBaseRoomCostMatrix } from "../../capabilities/movement/roomCostMatrix"
import { moveCreep } from "../../capabilities/movement/movement"
import { setWorkingArea } from "../../capabilities/movement/traffic"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { intelStore } from "../../world/intel/intelStore"

interface ReserverRuntime {
  seekingControllerPosition?: boolean
}

const reserverRuntimes = runtimeRegistry.createCache<string, ReserverRuntime>("harvest.reservers", {
  cleanupInterval: 100,
  cleanup: (runtimes) => {
    for (const creepName of runtimes.keys()) {
      if (Game.creeps[creepName] === undefined) {
        runtimes.delete(creepName)
      }
    }
  },
})

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
  const runtime = getReserverRuntime(reserver.name)

  if (!runtime.seekingControllerPosition) {
    if (reserver.pos.inRangeTo(controllerPos, 2)) {
      runtime.seekingControllerPosition = true
    } else {
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
  }

  if (!reserver.pos.isNearTo(controllerPos)) {
    setWorkingArea(reserver, controllerPos, 2)

    const freePosition = findFreeControllerPosition(reserver, controllerPos)

    if (freePosition !== undefined) {
      moveCreep(reserver, { pos: freePosition, range: 0 })
    }
    return
  }

  const controller = Game.getObjectById(controllerIntel.id)

  if (controller === null || controller.owner !== undefined) {
    return
  }

  setWorkingArea(reserver, controller.pos, 1)

  const reservation = controller.reservation

  if (reservation !== undefined && reservation.username !== reserver.owner.username) {
    reserver.attackController(controller)
    return
  }

  reserver.reserveController(controller)
}

function getReserverRuntime(creepName: string): ReserverRuntime {
  let runtime = reserverRuntimes.get(creepName)

  if (runtime === undefined) {
    runtime = {}
    reserverRuntimes.set(creepName, runtime)
  }

  return runtime
}

function findFreeControllerPosition(reserver: Creep, controllerPos: RoomPosition): RoomPosition | undefined {
  const terrain = Game.map.getRoomTerrain(controllerPos.roomName)
  const costs = getBaseRoomCostMatrix(controllerPos.roomName)

  let bestPosition: RoomPosition | undefined
  let bestRange = Infinity

  for (let x = controllerPos.x - 1; x <= controllerPos.x + 1; x++) {
    for (let y = controllerPos.y - 1; y <= controllerPos.y + 1; y++) {
      if (x === controllerPos.x && y === controllerPos.y) {
        continue
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL || costs?.get(x, y) === 255) {
        continue
      }

      const position = new RoomPosition(x, y, controllerPos.roomName)

      if (position.lookFor(LOOK_CREEPS).length > 0 || position.lookFor(LOOK_POWER_CREEPS).length > 0) {
        continue
      }

      const range = reserver.pos.getRangeTo(position)

      if (range < bestRange) {
        bestPosition = position
        bestRange = range
      }
    }
  }

  return bestPosition
}
