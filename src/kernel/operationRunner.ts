import { colonyOperationHandler } from "../operations/colony/colonyOperation";
import { empireOperationHandler } from "../operations/empire/empireOperation";
import {
  getChildOperations,
  type OperationRecord,
} from "../operations/operation";
import { ownedSourceOperationHandler } from "../operations/ownedSource/ownedSourceOperation";
import type { TickContext } from "./tickContext";

function planOperation(operation: OperationRecord, context: TickContext): void {
  switch (operation.type) {
    case "empire":
      empireOperationHandler.plan?.(operation, context);
      return;
    case "colony":
      colonyOperationHandler.plan?.(operation, context);
      return;
    case "ownedSource":
      ownedSourceOperationHandler.plan?.(operation, context);
      return;
  }

  assertUnreachable(operation);
}

function executeOperation(
  operation: OperationRecord,
  context: TickContext,
): void {
  switch (operation.type) {
    case "empire":
      empireOperationHandler.execute?.(operation, context);
      return;
    case "colony":
      colonyOperationHandler.execute?.(operation, context);
      return;
    case "ownedSource":
      ownedSourceOperationHandler.execute?.(operation, context);
      return;
  }

  assertUnreachable(operation);
}

function assertUnreachable(operation: never): never {
  throw new Error("Unknown operation type");
}

export function planOperationTree(
  operation: OperationRecord,
  context: TickContext,
): void {
  if (operation.status !== "active") {
    return;
  }

  planOperation(operation, context);

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

  executeOperation(operation, context);

  for (const child of getChildOperations(operation.id)) {
    executeOperationTree(child, context);
  }
}
