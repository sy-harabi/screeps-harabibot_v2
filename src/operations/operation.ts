import { registerOperationInTickContext, unregisterOperationFromTickContext } from "../kernel/tickContext"
import { clearOperationRuntime } from "../runtime/operationRuntime"
import type { ColonyOperationRecord } from "./colony/colonyOperation"
import type { EmpireOperationRecord } from "./empire/empireOperation"
import type { HarvestOperationRecord } from "./harvest/harvestOperation"

export type OperationStatus = "active" | "completed"

export interface OperationBase {
  readonly id: string
  readonly type: string
  readonly parentId?: string
  status: OperationStatus
  completedAt?: number
  result?: unknown
}

export type OperationRecord = EmpireOperationRecord | ColonyOperationRecord | HarvestOperationRecord

export type OperationsMemory = Record<string, OperationRecord>

function getOperationsMemory(): OperationsMemory {
  Memory.operations ??= {}

  return Memory.operations
}

export function ensureOperation(operation: OperationRecord): OperationRecord {
  const memory = getOperationsMemory()
  const existing = memory[operation.id]

  if (existing !== undefined) {
    existing.status ??= "active"
    return existing
  }

  memory[operation.id] = operation
  registerOperationInTickContext(operation)
  return operation
}

export function removeOperation(operationId: string): void {
  const memory = getOperationsMemory()
  const operation = memory[operationId]

  if (operation !== undefined) {
    unregisterOperationFromTickContext(operation)
    delete memory[operationId]
  }

  clearOperationRuntime(operationId)
}
