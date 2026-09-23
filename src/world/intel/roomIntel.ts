import type { RoomCoordinate } from "../map/roomCoordinate"

export function createRoomIntel(room: Room): RoomIntel {
  const roomIntel: RoomIntel = {
    roomName: room.name,
    lastSeen: Game.time,
  }

  const sources = room.find(FIND_SOURCES)

  const sourceIntels =
    sources.length > 0
      ? sources.map((source) => ({ id: source.id, coordinate: { x: source.pos.x, y: source.pos.y } }))
      : undefined

  const minerals = room.find(FIND_MINERALS)

  const mineralIntels =
    minerals.length > 0
      ? minerals.map((mineral) => ({
          id: mineral.id,
          coordinate: { x: mineral.pos.x, y: mineral.pos.y },
          mineralType: mineral.mineralType,
        }))
      : undefined

  const controller = room.controller

  const controllerIntel = controller
    ? {
        id: controller.id,
        coordinate: { x: controller.pos.x, y: controller.pos.y },
        owner: controller.owner ? { username: controller.owner.username, level: controller.level } : undefined,
        reservation: controller.reservation
          ? { username: controller.reservation.username, ticksToEnd: controller.reservation.ticksToEnd }
          : undefined,
      }
    : undefined

  const keeperLairs = room
    .find(FIND_HOSTILE_STRUCTURES)
    .filter((structure) => structure.structureType === STRUCTURE_KEEPER_LAIR)

  const keeperLairIntel =
    keeperLairs.length > 0 ? keeperLairs.map((lair) => ({ x: lair.pos.x, y: lair.pos.y })) : undefined

  return {
    roomName: room.name,
    lastSeen: Game.time,
    sources: sourceIntels,
    minerals: mineralIntels,
    controller: controllerIntel,
    keeperLairs: keeperLairIntel,
  }
}

export interface RoomIntel {
  readonly roomName: string
  readonly lastSeen: number

  readonly sources?: readonly SourceIntel[]
  readonly minerals?: readonly MineralIntel[]
  readonly controller?: ControllerIntel
  readonly keeperLairs?: readonly RoomCoordinate[]
}

export interface SourceIntel {
  readonly id: Id<Source>
  readonly coordinate: RoomCoordinate
}

export interface MineralIntel {
  readonly id: Id<Mineral>
  readonly coordinate: RoomCoordinate
  readonly mineralType: MineralConstant
}

export interface ControllerIntel {
  readonly id: Id<StructureController>
  readonly coordinate: RoomCoordinate

  readonly owner?: {
    readonly username: string
    readonly level: number
  }

  readonly reservation?: {
    readonly username: string
    readonly ticksToEnd: number
  }
}
