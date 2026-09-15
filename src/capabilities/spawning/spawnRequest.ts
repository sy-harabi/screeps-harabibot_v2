import { SpawnPriority } from "./spawnPriority";

export interface SpawnRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly role: string;
  readonly body: readonly BodyPartConstant[];
  readonly priority: SpawnPriority;
  readonly scope: SpawnScope;
  readonly memory: CreepMemory;
}

export interface RenewRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly creepName: string;
  readonly roomName: string;
  readonly priority: SpawnPriority;
}

export type SpawnScope =
  | {
      readonly type: "rooms";
      readonly roomNames: readonly string[];
    }
  | {
      readonly type: "empire";
    };
