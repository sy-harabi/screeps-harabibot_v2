import { createColonyOperation } from "../colony/colonyOperation";
import { ensureOperation, OperationBase } from "../operation";
import type { OperationHandler } from "../operationHandler";

export const empireOperationId = "empire";

export interface EmpireOperationRecord extends OperationBase {
  readonly id: typeof empireOperationId;
  readonly type: "empire";
}

export function createEmpireOperation(): EmpireOperationRecord {
  return {
    id: empireOperationId,
    type: "empire",
    status: "active",
  };
}

export const empireOperationHandler: OperationHandler<EmpireOperationRecord> = {
  plan(operation, context): void {
    for (const room of context.ownedRooms.values()) {
      ensureOperation(createColonyOperation(room.name));
    }
  },
};
