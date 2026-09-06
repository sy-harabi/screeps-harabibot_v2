import { colonyOperationHandler } from "../operations/colony/colonyOperation";
import { empireOperationHandler } from "../operations/empire/empireOperation";
import type { OperationRecord } from "../operations/operation";
import type { OperationHandler } from "../operations/operationHandler";
import { getChildOperations } from "../operations/operationStore";
import type { TickContext } from "./tickContext";

function getOperationHandler(operation: OperationRecord): OperationHandler {
  switch (operation.type) {
    case "empire":
      return empireOperationHandler;
    case "colony":
      return colonyOperationHandler;
    default:
      throw new Error("Unknown operation type");
  }
}

export function planOperationTree(
  operation: OperationRecord,
  context: TickContext,
): void {
  if (operation.status !== "active") {
    return;
  }

  getOperationHandler(operation).plan?.(operation, context);

  for (const child of getChildOperations(operation.id)) {
    planOperationTree(child, context);
  }
}

export function executeOperationTree(
  operation: OperationRecord,
  context: TickContext,
): void {
  if (operation.status !== "active") {
    return;
  }

  getOperationHandler(operation).execute?.(operation, context);

  for (const child of getChildOperations(operation.id)) {
    executeOperationTree(child, context);
  }
}
