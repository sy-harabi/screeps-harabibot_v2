import type { OperationRecord, OperationsMemory } from "./operation";

function getOperationsMemory(): OperationsMemory {
  Memory.operations ??= {};

  return Memory.operations;
}

export function ensureOperation(operation: OperationRecord): OperationRecord {
  const memory = getOperationsMemory();
  const existing = memory[operation.id];

  if (existing !== undefined) {
    return existing;
  }

  memory[operation.id] = operation;
  return operation;
}
