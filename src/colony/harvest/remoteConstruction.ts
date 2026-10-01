export const REMOTE_ROAD_ENERGY_CAPACITY = 750

export interface RemoteConstructionSourceMemory {
  useRoad?: boolean

  // Road construction progresses from source -> base.
  nextRoadIndex?: number

  // Used later for periodic maintenance.
  nextMaintenanceTick?: number
}

export interface RemoteConstructionMemory {
  sources: Record<string, RemoteConstructionSourceMemory>
}

export function areRemoteRoadsEnabled(room: Room): boolean {
  return room.energyCapacityAvailable >= REMOTE_ROAD_ENERGY_CAPACITY
}

export function getRemoteConstructionMemory(room: Room): RemoteConstructionMemory {
  return (room.memory.remoteConstruction ??= {
    sources: {},
  })
}

export function getRemoteConstructionSourceMemory(room: Room, sourceId: Id<Source>): RemoteConstructionSourceMemory {
  const memory = getRemoteConstructionMemory(room)

  return (memory.sources[sourceId] ??= {})
}
