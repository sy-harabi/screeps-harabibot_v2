import type { CreepRole } from "../../creeps/creepRole"
import type { SpawnPriority } from "./spawnPriority"

export type SpawnBody = readonly BodyPartConstant[] | (() => readonly BodyPartConstant[] | undefined)

export interface SpawnRequest {
  readonly requesterId: string
  readonly spawnRoomName: string
  readonly role: CreepRole
  readonly body: SpawnBody
  readonly priority: SpawnPriority
  readonly memory: CreepMemory
}

export interface RenewRequest {
  readonly requesterId: string
  readonly creepName: string
  readonly spawnRoomName: string
  readonly priority: SpawnPriority
}
