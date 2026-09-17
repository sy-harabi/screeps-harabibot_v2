import type { SpawnPriority } from "./spawnPriority"

export interface SpawnRequest {
  readonly requesterId: string
  readonly roomName: string
  readonly role: string
  readonly body: readonly BodyPartConstant[]
  readonly priority: SpawnPriority
  readonly memory: CreepMemory
}

export interface RenewRequest {
  readonly requesterId: string
  readonly creepName: string
  readonly roomName: string
  readonly priority: SpawnPriority
}
