import type {
  RenewRequest,
  SpawnRequest,
} from "../capabilities/spawning/spawnRequest";

export interface SpawnRoomState {
  readonly freeSpawns: readonly StructureSpawn[];
}

export interface TickContext {
  readonly ownedRooms: readonly Room[];
  readonly spawnRooms: ReadonlyMap<string, SpawnRoomState>;

  readonly spawnRequests: SpawnRequest[];
  readonly renewRequests: RenewRequest[];
}

export function createTickContext(): TickContext {
  const ownedRooms = Object.values(Game.rooms).filter(
    (room) => room.controller?.my === true,
  );

  const spawnRooms = new Map<string, SpawnRoomState>();

  for (const room of ownedRooms) {
    const freeSpawns = room
      .find(FIND_MY_SPAWNS)
      .filter((spawn) => spawn.isActive() && !spawn.spawning);
    spawnRooms.set(room.name, { freeSpawns });
  }

  return {
    ownedRooms,
    spawnRooms,
    spawnRequests: [],
    renewRequests: [],
  };
}
