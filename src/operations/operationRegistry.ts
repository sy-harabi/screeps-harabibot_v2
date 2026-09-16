import {
  empireOperationHandler,
  EmpireOperationRecord,
} from "./empire/empireOperation";
import {
  colonyOperationHandler,
  ColonyOperationRecord,
} from "./colony/colonyOperation";
import {
  ownedSourceOperationHandler,
  OwnedSourceOperationRecord,
} from "./ownedSource/ownedSourceOperation";
import { OperationHandler } from "./operationHandler";

export interface OperationMap {
  empire: EmpireOperationRecord;
  colony: ColonyOperationRecord;
  ownedSource: OwnedSourceOperationRecord;
}

export type OperationType = keyof OperationMap;

export type OperationRecord = OperationMap[OperationType];

export type OperationHandlerMap = {
  [K in OperationType]: OperationHandler<OperationMap[K]>;
};

export const operationHandlers = {
  empire: empireOperationHandler,
  colony: colonyOperationHandler,
  ownedSource: ownedSourceOperationHandler,
};
