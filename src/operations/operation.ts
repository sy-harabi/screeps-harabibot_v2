import type { ColonyOperationRecord } from "./colony/colonyOperation";
import type { EmpireOperationRecord } from "./empire/empireOperation";

export type OperationRecord = EmpireOperationRecord | ColonyOperationRecord;

export interface OperationsMemory {
  records: Record<string, OperationRecord>;
}
