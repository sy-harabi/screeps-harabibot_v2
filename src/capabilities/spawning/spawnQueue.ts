import { TickContext } from "../../kernel/tickContext";
import { SpawnPriority } from "./spawnPriority";
import { RenewRequest, SpawnRequest } from "./spawnRequest";

export interface SpawnRoomState {
  readonly freeSpawns: readonly StructureSpawn[];
  readonly spawnRequests: SpawnRequest[];
  readonly renewRequests: RenewRequest[];
}

export function requestSpawn(
  context: TickContext,
  requesterId: string,
  roomName: string,
  body: readonly BodyPartConstant[],
  role: string,
  priority: SpawnPriority,
  options: {
    memory?: CreepMemory;
  },
): void {
  const request: SpawnRequest = {
    requesterId,
    roomName,
    role,
    body,
    priority,
    memory: (options.memory ??= {}),
  };

  context.spawnRooms.get(roomName)?.spawnRequests.push(request);
}

export function requestRenew(
  context: TickContext,
  requesterId: string,
  roomName: string,
  creepName: string,
  priority: SpawnPriority,
): void {
  const request: RenewRequest = {
    requesterId,
    creepName,
    roomName,
    priority,
  };

  context.spawnRooms.get(roomName)?.renewRequests.push(request);
}
