import { getCreepCapabilities, type CreepCapabilities } from "../../creeps/creepCapabilities"
import { toRoomIndex } from "../map/roomGrid"

export interface CreepIntel {
  readonly owner: string

  readonly lastSeen: number
  readonly lastSeenRoomName: string
  readonly lastSeenPos: number

  readonly ttlExpiresAt?: number

  readonly capabilities: CreepCapabilities
}

export function createCreepIntel(creep: Creep): CreepIntel {
  return {
    owner: creep.owner.username,

    lastSeen: Game.time,
    lastSeenRoomName: creep.pos.roomName,
    lastSeenPos: toRoomIndex(creep.pos.x, creep.pos.y),

    ttlExpiresAt: creep.ticksToLive === undefined ? undefined : Game.time + creep.ticksToLive,

    capabilities: getCreepCapabilities(creep),
  }
}
