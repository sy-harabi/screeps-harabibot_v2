export interface SpawnRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly role: string;
  readonly body: readonly BodyPartConstant[];
  readonly priority: number;
  readonly scope: SpawnScope;
  readonly memory: CreepMemory;
}

export interface RenewRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly creepName: string;
  readonly roomName: string;
  readonly priority: number;
}

export type SpawnScope =
  | {
      readonly type: "rooms";
      readonly roomNames: readonly string[];
    }
  | {
      readonly type: "empire";
    };
