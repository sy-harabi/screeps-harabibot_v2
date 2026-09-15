import { getTickContext } from "../../kernel/tickContext";
import { SpawnPriority, SpawnPriorityType } from "./spawnPriority";
import { RenewRequest, SpawnRequest } from "./spawnRequest";

interface SpawnRoomState {
  readonly freeSpawns: readonly StructureSpawn[];
  readonly spawnRequests: SpawnRequest[];
  readonly renewRequests: RenewRequest[];
}

const roomStates = new Map<string, SpawnRoomState>();

let stateTick: number | undefined;

export function getSpawnRoomStates(): ReadonlyMap<string, SpawnRoomState> {
  prepareState();
  return roomStates;
}

export function requestSpawn(
  requesterId: string,
  roomName: string,
  body: readonly BodyPartConstant[],
  role: string,
  priorityType: SpawnPriorityType,
  options: {
    order: 0;
    memory?: CreepMemory;
  },
): void {
  const state = getSpawnRoomState(roomName);

  if (state === undefined || state.freeSpawns.length === 0) {
    return;
  }

  state.spawnRequests.push({
    requesterId,
    roomName,
    role,
    body,
    priority: {
      type: priorityType,
      order: options.order ?? 0,
    },
    memory: options.memory ?? {},
  });
}

export function requestRenew(
  requesterId: string,
  roomName: string,
  creepName: string,
  priorityType: SpawnPriorityType,
  options: {
    order: 0;
  },
): void {
  const state = getSpawnRoomState(roomName);

  if (state === undefined || state.freeSpawns.length === 0) {
    return;
  }

  state.renewRequests.push({
    requesterId,
    creepName,
    roomName,
    priority: { type: priorityType, order: options.order ?? 0 },
  });
}

function getSpawnRoomState(roomName: string): SpawnRoomState | undefined {
  prepareState();

  const existing = roomStates.get(roomName);

  if (existing !== undefined) {
    return existing;
  }

  const context = getTickContext();
  const room = context.ownedRooms.get(roomName);

  if (room === undefined) {
    return undefined;
  }

  const state: SpawnRoomState = {
    freeSpawns: room
      .find(FIND_MY_SPAWNS)
      .filter((spawn) => spawn.isActive() && !spawn.spawning),

    spawnRequests: [],
    renewRequests: [],
  };

  roomStates.set(roomName, state);

  return state;
}

function prepareState(): void {
  if (stateTick === Game.time) {
    return;
  }

  roomStates.clear();
  stateTick = Game.time;
}
