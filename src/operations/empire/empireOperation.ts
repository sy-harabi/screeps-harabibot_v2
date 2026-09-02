import { createColonyOperation } from "../colony/colonyOperation";
import { ensureOperation } from "../operationStore";

export const empireOperationId = "empire";

export interface EmpireOperationRecord {
  readonly id: typeof empireOperationId;
  readonly type: "empire";
}

export function createEmpireOperation(): EmpireOperationRecord {
  return {
    id: empireOperationId,
    type: "empire",
  };
}

export function planEmpireOperation(ownedRooms: readonly Room[]): void {
  for (const room of ownedRooms) {
    ensureOperation(createColonyOperation(room.name));
  }
}
