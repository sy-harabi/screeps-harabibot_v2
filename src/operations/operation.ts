import { clearOperationRuntime } from "../runtime/operationRuntime";
import type { ColonyOperationRecord } from "./colony/colonyOperation";
import type { EmpireOperationRecord } from "./empire/empireOperation";
import { OwnedSourceOperationRecord } from "./ownedSource/ownedSourceOperation";

export type OperationStatus = "active" | "completed";

export interface OperationBase {
  readonly id: string;
  readonly type: string;
  readonly parentId?: string;
  status: OperationStatus;
  completedAt?: number;
  result?: unknown;
}

export type OperationRecord =
  EmpireOperationRecord | ColonyOperationRecord | OwnedSourceOperationRecord;

export type OperationsMemory = Record<string, OperationRecord>;

function getOperationsMemory(): OperationsMemory {
  Memory.operations ??= {};

  return Memory.operations;
}

export function ensureOperation(operation: OperationRecord): OperationRecord {
  const memory = getOperationsMemory();
  const existing = memory[operation.id];

  if (existing !== undefined) {
    existing.status ??= "active";
    return existing;
  }

  memory[operation.id] = operation;
  return operation;
}

export function getChildOperations(parentId: string): OperationRecord[] {
  return Object.values(getOperationsMemory()).filter(
    (operation) => operation.parentId === parentId,
  );
}

export function removeOperation(operationId: string): void {
  delete getOperationsMemory()[operationId];
  clearOperationRuntime(operationId);
}
