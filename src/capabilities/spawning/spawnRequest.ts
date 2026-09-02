export interface SpawnRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly role: string;
  readonly body: readonly BodyPartConstant[];
  readonly priority: number;
  readonly preferredRoomNames?: readonly string[];
  readonly memory: CreepMemory;
}
