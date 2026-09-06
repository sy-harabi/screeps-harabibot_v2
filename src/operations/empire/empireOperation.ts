import type { TickContext } from "../../kernel/tickContext";
import { createColonyOperation } from "../colony/colonyOperation";
import type { OperationBase } from "../operation";
import type { OperationHandler } from "../operationHandler";
import { ensureOperation } from "../operationStore";

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

export const empireOperationHandler: OperationHandler = {
  plan(operation, context: TickContext): void {
    if (operation.type !== "empire") {
      return;
    }

    for (const room of context.ownedRooms) {
      ensureOperation(createColonyOperation(room.name));
    }
  },

  execute(): void {},
};
