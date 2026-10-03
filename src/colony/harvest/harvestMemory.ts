export interface HarvestSourceMemory {
  useRoad?: boolean

  // Road construction progresses from source -> base.
  constructionRoadIndex?: number

  // Initial container and road construction is complete.
  roadsEstablished?: boolean

  // Used by periodic maintenance.
  nextMaintenanceTick?: number
  lastReadyTick?: number
}

export interface HarvestMemory {
  sources: Record<string, HarvestSourceMemory>
}

export function getHarvestMemory(room: Room): HarvestMemory {
  return (room.memory.harvest ??= {
    sources: {},
  })
}

export function getHarvestSourceMemory(room: Room, sourceId: Id<Source>): HarvestSourceMemory {
  const memory = getHarvestMemory(room)

  return (memory.sources[sourceId] ??= {})
}
