export const SPAWN_PRIORITY_ORDER = [
  "logistics",
  "ownedSource",
  "defense",
  "criticalUpgrade",
  "remoteDefense",
  "scout",
  "build",
  "combat",
  "ownedMineral",
  "remoteSource",
  "upgrade",
] as const

export type SpawnPriorityType = (typeof SPAWN_PRIORITY_ORDER)[number]

export interface SpawnPriority {
  readonly type: SpawnPriorityType
  readonly operationOrder: number
  readonly roleOrder: number
}

const priorityIndex = new Map<SpawnPriorityType, number>(SPAWN_PRIORITY_ORDER.map((type, index) => [type, index]))

export function compareSpawnPriority(left: SpawnPriority, right: SpawnPriority): number {
  const typeDifference = priorityIndex.get(left.type)! - priorityIndex.get(right.type)!

  return typeDifference || left.operationOrder - right.operationOrder || left.roleOrder - right.roleOrder
}
