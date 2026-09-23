export interface IntelMemory {
  roomNames: string[]
  dynamic: PackedRoomDynamicIntel[]
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

function unpackDynamicIntel(intel: PackedRoomDynamicIntel): RoomDynamicIntel {
  const lastSeen = intel[0]

  const index = intel[1]

  if (!index) {
    return { lastSeen }
  }

  const username = intel[2]!

  if (index === 1) {
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
  } else if (index === 2) {
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

  throw new Error(`Room intel has index ${index}`)
}

function packDynamicIntel(intel: RoomDynamicIntel): PackedRoomDynamicIntel {
  const controller = intel.controller

  if (controller?.owner) {
    return [intel.lastSeen, 1, controller.owner.username, controller.owner.level]
  }

  if (controller?.reservation) {
    return [intel.lastSeen, 2, controller.reservation.username, controller.reservation.endTick]
  }

  return [intel.lastSeen]
}
