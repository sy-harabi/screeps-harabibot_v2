import { moveCreep } from "../../capabilities/movement/movement"
import { requestSpawn } from "../../capabilities/spawning/spawnQueue"
import { getColonyCreeps, type TickContext } from "../../kernel/tickContext"
import { intelStore } from "../../world/intel/intelStore"
import type { SourceState } from "./harvest"
import type { RemoteRoomData } from "./remoteRoomData"
import { remoteRoomDataStore } from "./remoteRoomDataStore"

export const RESERVER_ROLE = "reserver"

const RESERVER_UNIT_COST = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]
const MAX_CLAIM_PARTS = 2
const REPLACEMENT_BUFFER = 20
const NEUTRAL_SOURCE_INCOME = SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME

export function runRemoteReservers(
  room: Room,
  context: TickContext,
  sourceStateById: ReadonlyMap<Id<Source>, SourceState>,
): void {
  const username = room.controller?.owner?.username

  if (username === undefined) {
    return
  }

  const reservers = getColonyCreeps(context, room.name, RESERVER_ROLE)
  const reserversByRemote = new Map<string, Creep[]>()

  for (const reserver of reservers) {
    const remoteRoomName = reserver.memory.remoteRoomName

    if (remoteRoomName === undefined) {
      continue
    }

    let remoteReservers = reserversByRemote.get(remoteRoomName)

    if (remoteReservers === undefined) {
      remoteReservers = []
      reserversByRemote.set(remoteRoomName, remoteReservers)
    }

    remoteReservers.push(reserver)
  }

  for (const remoteRoomName of remoteRoomDataStore.getByColony(room.name)) {
    const remote = remoteRoomDataStore.get(remoteRoomName)

    if (remote === undefined || !isReadyForReservation(remote, sourceStateById)) {
      continue
    }

    const body = createReserverBody(room)

    if (body === undefined) {
      continue
    }

    const intel = intelStore.get(remoteRoomName)
    const controller = intel?.controller

    if (controller === undefined) {
      continue
    }

    const travelTicks = getRemoteTravelTicks(remote)
    const replacementLeadTime = body.length * CREEP_SPAWN_TIME + travelTicks + REPLACEMENT_BUFFER
    const remoteReservers = reserversByRemote.get(remoteRoomName) ?? []

    if (remoteReservers.some((reserver) => (reserver.ticksToLive ?? CREEP_CLAIM_LIFE_TIME) > replacementLeadTime)) {
      continue
    }

    const reservation = controller.reservation
    const reservationActive = reservation !== undefined && reservation.endTick > Game.time
    const foreignReservation = reservationActive && reservation.username !== username

    if (!foreignReservation && reservationActive && reservation.endTick - Game.time > replacementLeadTime) {
      continue
    }

    requestSpawn(
      {
        requesterId: `reserve:${remoteRoomName}`,
        spawnRoomName: room.name,
        assignment: {
          type: "colony",
          colonyName: room.name,
        },
        priorityType: "remoteSource",
        order: travelTicks,
        rolesByPriority: [RESERVER_ROLE],
      },
      body,
      RESERVER_ROLE,
      {
        memory: {
          remoteRoomName,
        },
      },
    )
  }

  for (const reserver of reservers) {
    runReserver(reserver, room.name)
  }
}

export function createReserverBody(room: Room): readonly BodyPartConstant[] | undefined {
  const count = Math.min(MAX_CLAIM_PARTS, Math.floor(room.energyCapacityAvailable / RESERVER_UNIT_COST))

  if (count === 0) {
    return
  }

  return [
    ...Array<BodyPartConstant>(count).fill(CLAIM),
    ...Array<BodyPartConstant>(count).fill(MOVE),
  ]
}

function isReadyForReservation(
  remote: RemoteRoomData,
  sourceStateById: ReadonlyMap<Id<Source>, SourceState>,
): boolean {
  for (const source of remote.sources) {
    const sourceState = sourceStateById.get(source.sourceId)

    if (sourceState === undefined) {
      continue
    }

    const requiredCarryCapacity = source.path.length * 2 * NEUTRAL_SOURCE_INCOME

    if (
      sourceState.harvestPower >= NEUTRAL_SOURCE_INCOME &&
      sourceState.carryCapacity >= requiredCarryCapacity
    ) {
      return true
    }
  }

  return false
}

function getRemoteTravelTicks(remote: RemoteRoomData): number {
  let travelTicks = Infinity

  for (const source of remote.sources) {
    travelTicks = Math.min(travelTicks, source.path.length)
  }

  return Number.isFinite(travelTicks) ? travelTicks : 0
}

function runReserver(creep: Creep, colonyName: string): void {
  if (creep.spawning) {
    return
  }

  const remoteRoomName = creep.memory.remoteRoomName

  if (remoteRoomName === undefined || remoteRoomDataStore.get(remoteRoomName)?.colonyName !== colonyName) {
    return
  }

  const intel = intelStore.get(remoteRoomName)
  const controllerIntel = intel?.controller

  if (controllerIntel === undefined) {
    return
  }

  const controllerPos = new RoomPosition(
    controllerIntel.coordinate.x,
    controllerIntel.coordinate.y,
    remoteRoomName,
  )

  if (!creep.pos.isNearTo(controllerPos)) {
    moveCreep(
      creep,
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

  if (reservation !== undefined && reservation.username !== creep.owner.username) {
    creep.attackController(controller)
    return
  }

  creep.reserveController(controller)
}
