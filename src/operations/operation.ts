import type { ColonyOperationRecord } from "./colony/colonyOperation";
import type { EmpireOperationRecord } from "./empire/empireOperation";

export type OperationStatus = "active" | "completed";

export interface OperationBase {
  readonly id: string;
  readonly type: string;
  readonly parentId?: string;
  status: OperationStatus;
  completedAt?: number;
  result?: unknown;
}

export type OperationRecord = EmpireOperationRecord | ColonyOperationRecord;

export type OperationsMemory = Record<string, OperationRecord>;
