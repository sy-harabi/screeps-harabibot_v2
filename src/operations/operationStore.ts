import type { OperationRecord, OperationsMemory } from "./operation";

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
}
