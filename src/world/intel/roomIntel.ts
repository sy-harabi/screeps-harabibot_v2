import type { RoomCoordinate } from "../map/roomCoordinate"

export interface RoomIntel {
  readonly staticCreatedAt: number

  readonly roomName: string
  readonly lastSeen: number

  readonly sources: readonly SourceIntel[]
  readonly minerals: readonly MineralIntel[]
  readonly keeperLairs: readonly RoomCoordinate[]

  readonly controller?: ControllerIntel
}

export interface ControllerIntel extends ControllerStaticIntel {
  readonly owner?: {
    readonly username: string
    readonly level: number
  }

  readonly reservation?: {
    readonly username: string
    readonly endTick: number
  }
}

export interface RoomStaticIntel {
  readonly staticCreatedAt: number

  readonly sources: readonly SourceIntel[]
  readonly minerals: readonly MineralIntel[]
  readonly controller?: ControllerStaticIntel
  readonly keeperLairs: readonly RoomCoordinate[]
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

export interface ControllerStaticIntel {
  readonly id: Id<StructureController>
  readonly coordinate: RoomCoordinate
}

export function mergeRoomIntel(
  roomName: string,
  staticIntel: RoomStaticIntel,
  dynamicIntel: RoomDynamicIntel,
): RoomIntel {
  return {
    roomName,
    lastSeen: dynamicIntel.lastSeen,

    staticCreatedAt: staticIntel.staticCreatedAt,
    sources: staticIntel.sources,
    minerals: staticIntel.minerals,
    keeperLairs: staticIntel.keeperLairs,

    controller: staticIntel.controller
      ? {
          ...staticIntel.controller,
          ...dynamicIntel.controller,
        }
      : undefined,
  }
}

export function createRoomDynamicIntel(room: Room): RoomDynamicIntel {
  const controller = room.controller

  if (!controller) {
    return {
      lastSeen: Game.time,
    }
  }

  return {
    lastSeen: Game.time,

    controller: {
      owner: controller.owner
        ? {
            username: controller.owner.username,
            level: controller.level,
          }
        : undefined,

      reservation: controller.reservation
        ? {
            username: controller.reservation.username,
            endTick: Game.time + controller.reservation.ticksToEnd,
          }
        : undefined,
    },
  }
}

export function createRoomStaticIntel(room: Room): RoomStaticIntel {
  const sources = room.find(FIND_SOURCES).map((source) => ({
    id: source.id,
    coordinate: {
      x: source.pos.x,
      y: source.pos.y,
    },
  }))

  const minerals = room.find(FIND_MINERALS).map((mineral) => ({
    id: mineral.id,
    coordinate: {
      x: mineral.pos.x,
      y: mineral.pos.y,
    },
    mineralType: mineral.mineralType,
  }))

  const keeperLairs = room
    .find(FIND_HOSTILE_STRUCTURES)
    .filter((structure): structure is StructureKeeperLair => structure.structureType === STRUCTURE_KEEPER_LAIR)
    .map((lair) => ({
      x: lair.pos.x,
      y: lair.pos.y,
    }))

  return {
    staticCreatedAt: Game.time,

    sources,
    minerals,
    controller: room.controller
      ? {
          id: room.controller.id,
          coordinate: {
            x: room.controller.pos.x,
            y: room.controller.pos.y,
          },
        }
      : undefined,
    keeperLairs,
  }
}

export type PackedRoomDynamicIntel =
  | [lastSeen: number]
  | [
      lastSeen: number,
      state: 1, // owned
      username: string,
      rcl: number,
    ]
  | [
      lastSeen: number,
      state: 2, // reserved
      username: string,
      endTick: number,
    ]

export interface RoomDynamicIntel {
  readonly lastSeen: number

  readonly controller?: {
    readonly owner?: {
      readonly username: string
      readonly level: number
    }

    readonly reservation?: {
      readonly username: string
      readonly endTick: number
    }
  }
}

export function unpackDynamicIntel(intel: PackedRoomDynamicIntel): RoomDynamicIntel {
  const lastSeen = intel[0]

  const state = intel[1]

  if (state === undefined) {
    return { lastSeen }
  }

  const username = intel[2]!

  if (state === 1) {
    const level = intel[3]!

    return {
      lastSeen,
      controller: {
        owner: {
          username,
          level,
        },
      },
    }
  } else if (state === 2) {
    const endTick = intel[3]!
    return {
      lastSeen,
      controller: {
        reservation: {
          username,
          endTick,
        },
      },
    }
  }

  throw new Error(`Room intel has state ${state}`)
}

export function packDynamicIntel(intel: RoomDynamicIntel): PackedRoomDynamicIntel {
  const controller = intel.controller

  if (controller?.owner) {
    return [intel.lastSeen, 1, controller.owner.username, controller.owner.level]
  }

  if (controller?.reservation) {
    return [intel.lastSeen, 2, controller.reservation.username, controller.reservation.endTick]
  }

  return [intel.lastSeen]
}
