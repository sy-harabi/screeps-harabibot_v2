import type { SpawnPriority } from "./spawnPriority"

export interface SpawnRequest {
  readonly requesterId: string
  readonly spawnRoomName: string
  readonly role: string
  readonly body: readonly BodyPartConstant[]
  readonly priority: SpawnPriority
  readonly memory: CreepMemory
}

export interface RenewRequest {
  readonly requesterId: string
  readonly creepName: string
  readonly spawnRoomName: string
  readonly priority: SpawnPriority
}
