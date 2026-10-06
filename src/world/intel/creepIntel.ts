import { type CreepBodyPart } from "../../creeps/creepBody"
import { toRoomIndex } from "../map/roomGrid"

export interface CreepIntel {
  readonly owner: string

  readonly lastSeen: number
  readonly lastSeenRoomName: string
  readonly lastSeenPos: number

  readonly ttlExpiresAt?: number

  readonly body: readonly CreepBodyPart[]
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
