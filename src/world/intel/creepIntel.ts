import { toRoomIndex } from "../map/roomGrid"

export interface CreepBodyPartIntel {
  readonly type: BodyPartConstant
  readonly hits: number
  readonly boost?: MineralBoostConstant
}

export interface CreepIntel {
  readonly owner: string

  readonly lastSeen: number
  readonly lastSeenRoomName: string
  readonly lastSeenPos: number

  readonly ttlExpiresAt?: number

  readonly body: readonly CreepBodyPartIntel[]
}

export function createCreepIntel(creep: Creep): CreepIntel {
  return {
    owner: creep.owner.username,

    lastSeen: Game.time,
    lastSeenRoomName: creep.pos.roomName,
    lastSeenPos: toRoomIndex(creep.pos.x, creep.pos.y),

    ttlExpiresAt: creep.ticksToLive === undefined ? undefined : Game.time + creep.ticksToLive,

    body: creep.body.map((part) => ({
      type: part.type,
      hits: part.hits,
      boost: part.boost as MineralBoostConstant | undefined,
    })),
  }
}
