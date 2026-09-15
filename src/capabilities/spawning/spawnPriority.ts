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
] as const;

export type SpawnPriorityType = (typeof SPAWN_PRIORITY_ORDER)[number];

export interface SpawnPriority {
  readonly type: SpawnPriorityType;
  readonly order?: number;
}

const priorityIndex = new Map<SpawnPriorityType, number>(
  SPAWN_PRIORITY_ORDER.map((type, index) => [type, index]),
);

export function compareSpawnPriority(
  a: SpawnPriority,
  b: SpawnPriority,
): number {
  const typeOrder = priorityIndex.get(a.type)! - priorityIndex.get(b.type)!;

  if (typeOrder !== 0) {
    return typeOrder;
  }

  return (a.order ?? 0) - (b.order ?? 0);
}
