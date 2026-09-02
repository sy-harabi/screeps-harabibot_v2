import type { ColonyOperationRecord } from "./colony/colonyOperation";
import type { EmpireOperationRecord } from "./empire/empireOperation";

export type OperationRecord = EmpireOperationRecord | ColonyOperationRecord;

export type OperationsMemory = Record<string, OperationRecord>;
