import type { SpawnRequest } from "../capabilities/spawning/spawnRequest";

export interface TickContext {
  readonly ownedRooms: readonly Room[];
  readonly spawnRequests: SpawnRequest[];
}

export function createTickContext(): TickContext {
  return {
    ownedRooms: Object.values(Game.rooms).filter(
      (room) => room.controller?.my === true,
    ),
    spawnRequests: [],
  };
}
