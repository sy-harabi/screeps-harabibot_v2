import type { OperationRecord, OperationsMemory } from "./operation";

function getOperationsMemory(): OperationsMemory {
  Memory.operations ??= {
    records: {},
  };

  return Memory.operations;
}

export function ensureOperation(operation: OperationRecord): OperationRecord {
  const memory = getOperationsMemory();
  const existing = memory.records[operation.id];

  if (existing !== undefined) {
    return existing;
  }

  memory.records[operation.id] = operation;
  return operation;
}
