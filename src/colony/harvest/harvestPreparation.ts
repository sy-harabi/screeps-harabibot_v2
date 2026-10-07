import type { BasePlan } from "../../capabilities/basePlanning/basePlan"
import { getDefaultRoomCostMatrix } from "../../capabilities/movement/defaultRoomCostMatrix"
import { intelStore } from "../../world/intel/intelStore"
import type { RoomIntel } from "../../world/intel/roomIntel"
import { getRequiredCarryCapacity } from "./hauler"
import { getHarvestSourceMemory } from "./harvestMemory"
import { harvestRoomPlanStore } from "./harvestRoomPlanStore"
import { getHarvestRuntime, type RemoteControllerRuntime } from "./harvestRuntime"
import type { HarvestRoomState, HarvestSourceState } from "./harvestState"
import { getHaulerTravelRuntime } from "./haulerTravel"
import { getMiningPositions, getSourceContainer } from "./miningSite"
import { getReservationState } from "./reservationPolicy"

const RESERVER_REPLACEMENT_BUFFER = 20

export interface PreparedHarvestState {
  readonly roomStates: HarvestRoomState[]
  readonly roomByName: Map<string, HarvestRoomState>
  readonly sourceStates: HarvestSourceState[]
  readonly sourceById: Map<Id<Source>, HarvestSourceState>
  readonly sourceIndexById: Map<Id<Source>, number>
}

export function prepareHarvestState(
  room: Room,
  basePlan: BasePlan,
  reserverBody: readonly BodyPartConstant[] | undefined,
  speedrun: boolean,
): PreparedHarvestState {
  const colonyName = room.name
  const username = room.controller?.owner?.username

  if (username === undefined) {
    return {
      roomStates: [],
      roomByName: new Map(),
      sourceStates: [],
      sourceById: new Map(),
      sourceIndexById: new Map(),
    }
  }

  const roomStates: HarvestRoomState[] = []
  const runtime = getHarvestRuntime(colonyName)

  runtime.miningPositionsBySource ??= new Map()

  for (const roomName of harvestRoomPlanStore.getByColony(colonyName)) {
    const harvestPlan = harvestRoomPlanStore.get(roomName)
    const intel = intelStore.get(roomName)

    if (harvestPlan === undefined || intel === undefined) {
      continue
    }

    const requiredHarvestPower = getRequiredHarvestPower(intel, username)
    const sources: HarvestSourceState[] = []

    for (const sourceIntel of intel.sources) {
      const sourcePlan = harvestPlan.sources.get(sourceIntel.id)

      if (sourcePlan === undefined) {
        continue
      }

      const haulerTravel = getHaulerTravelRuntime(basePlan, sourceIntel.id, sourcePlan.path, speedrun)

      const cachedMiningPositions = runtime.miningPositionsBySource.get(sourceIntel.id)
      const miningPositions =
        cachedMiningPositions?.path === sourcePlan.path
          ? cachedMiningPositions.positions
          : getMiningPositions(roomName, sourceIntel.coordinate, sourcePlan.path)

      if (cachedMiningPositions?.path !== sourcePlan.path) {
        runtime.miningPositionsBySource.set(sourceIntel.id, {
          path: sourcePlan.path,
          positions: miningPositions,
        })
      }

      const container = getSourceContainer(sourcePlan.path)
      const sourceObject = Game.getObjectById(sourceIntel.id)

      let droppedEnergy = 0
      let largestDroppedEnergy: Resource<ResourceConstant> | undefined

      if (sourceObject !== null) {
        for (const resource of sourceObject.pos.findInRange(FIND_DROPPED_RESOURCES, 1)) {
          if (resource.resourceType !== RESOURCE_ENERGY) {
            continue
          }

          droppedEnergy += resource.amount

          if (largestDroppedEnergy === undefined || resource.amount > largestDroppedEnergy.amount) {
            largestDroppedEnergy = resource
          }
        }
      }

      const useRoadPath =
        !speedrun &&
        (roomName === colonyName
          ? (room.controller?.level ?? 0) >= 3
          : getHarvestSourceMemory(room, sourceIntel.id).roadsEstablished === true)
      const haulerCycleTravelTicks = useRoadPath
        ? haulerTravel.emptyTravelTicks + sourcePlan.path.length
        : haulerTravel.cycleTravelTicks

      sources.push({
        id: sourceIntel.id,
        roomName,
        path: sourcePlan.path,
        haulerTravel,
        useRoadPath,
        haulerCycleTravelTicks,

        miningPositions,
        requiredHarvestPower,
        requiredCarryCapacity: getRequiredCarryCapacity(
          requiredHarvestPower,
          haulerCycleTravelTicks,
          speedrun ? haulerTravel.emptyPath.length : undefined,
        ),
        sourceObject: sourceObject ?? undefined,
        container,
        containerEnergy: container?.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0,
        droppedEnergy,
        largestDroppedEnergy,

        sustainableHarvestPower: 0,
        activeHarvestPower: 0,
        numMiners: 0,
      })
    }

    sources.sort((left, right) => left.path.length - right.path.length || left.id.localeCompare(right.id))

    const reservationState = getReservationState(intel, username)
    let controllerTravelTicks: number | undefined
    let reserverLeadTime: number | undefined

    if (roomName !== colonyName) {
      const controllerRuntime = getRemoteControllerRuntime(basePlan, roomName, intel, sources)

      controllerTravelTicks = controllerRuntime?.travelTicks

      if (controllerRuntime !== undefined && reserverBody !== undefined) {
        reserverLeadTime =
          reserverBody.length * CREEP_SPAWN_TIME + controllerRuntime.travelTicks + RESERVER_REPLACEMENT_BUFFER
      }
    }

    roomStates.push({
      roomName,
      intel,
      sources,
      reservationState,
      controllerTravelTicks,
      reserverLeadTime,
      reservePower: 0,
      hasReserver: false,
    })
  }

  roomStates.sort((left, right) => {
    const leftRemote = left.roomName !== colonyName
    const rightRemote = right.roomName !== colonyName
    const leftDistance = left.sources[0]?.path.length ?? Infinity
    const rightDistance = right.sources[0]?.path.length ?? Infinity

    return (
      Number(leftRemote) - Number(rightRemote) ||
      leftDistance - rightDistance ||
      left.roomName.localeCompare(right.roomName)
    )
  })

  const roomByName = new Map<string, HarvestRoomState>()
  const sourceStates: HarvestSourceState[] = []
  const sourceById = new Map<Id<Source>, HarvestSourceState>()
  const sourceIndexById = new Map<Id<Source>, number>()

  for (const roomState of roomStates) {
    roomByName.set(roomState.roomName, roomState)

    for (let i = 0; i < roomState.sources.length; i++) {
      const source = roomState.sources[i]

      sourceStates.push(source)
      sourceById.set(source.id, source)
      sourceIndexById.set(source.id, i)
    }
  }

  return {
    roomStates,
    roomByName,
    sourceStates,
    sourceById,
    sourceIndexById,
  }
}

function getRemoteControllerRuntime(
  basePlan: BasePlan,
  roomName: string,
  intel: RoomIntel,
  sources: readonly HarvestSourceState[],
): RemoteControllerRuntime | undefined {
  const controller = intel.controller

  if (controller === undefined) {
    return
  }

  const runtime = getHarvestRuntime(basePlan.roomName)

  runtime.remoteControllersByRoom ??= new Map()

  const cached = runtime.remoteControllersByRoom.get(roomName)

  if (cached !== undefined) {
    return cached
  }

  const allowedRooms = new Set<string>([basePlan.roomName, roomName])

  for (const source of sources) {
    for (const pos of source.path) {
      allowedRooms.add(pos.roomName)
    }
  }

  const result = PathFinder.search(
    new RoomPosition(basePlan.storage.x, basePlan.storage.y, basePlan.roomName),
    {
      pos: new RoomPosition(controller.coordinate.x, controller.coordinate.y, roomName),
      range: 1,
    },
    {
      plainCost: 1,
      swampCost: 5,
      maxRooms: allowedRooms.size,
      maxOps: allowedRooms.size * 2000,
      roomCallback: (currentRoomName) => {
        if (!allowedRooms.has(currentRoomName)) {
          return false
        }

        return getDefaultRoomCostMatrix(currentRoomName)?.clone() ?? new PathFinder.CostMatrix()
      },
    },
  )

  if (result.incomplete) {
    return
  }

  const controllerRuntime: RemoteControllerRuntime = {
    travelTicks: result.cost,
    availablePositions: countControllerPositions(roomName, controller.coordinate.x, controller.coordinate.y),
  }

  runtime.remoteControllersByRoom.set(roomName, controllerRuntime)

  return controllerRuntime
}

function countControllerPositions(roomName: string, controllerX: number, controllerY: number): number {
  const terrain = Game.map.getRoomTerrain(roomName)
  let result = 0

  for (let x = Math.max(0, controllerX - 1); x <= Math.min(49, controllerX + 1); x++) {
    for (let y = Math.max(0, controllerY - 1); y <= Math.min(49, controllerY + 1); y++) {
      if (x === controllerX && y === controllerY) {
        continue
      }

      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        result++
      }
    }
  }

  return result
}

function getRequiredHarvestPower(intel: RoomIntel, username: string): number {
  const controller = intel.controller

  if (controller === undefined) {
    return 0
  }

  if (controller.owner !== undefined) {
    return controller.owner.username === username ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME : 0
  }

  if (controller.reservation !== undefined && controller.reservation.endTick > Game.time) {
    return controller.reservation.username === username ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME : 0
  }

  return SOURCE_ENERGY_NEUTRAL_CAPACITY / ENERGY_REGEN_TIME
}

