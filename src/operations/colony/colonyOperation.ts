import type { EmpireOperationRecord } from "../empire/empireOperation";
import type { OperationBase } from "../operation";
import type { OperationHandler } from "../operationHandler";

export interface ColonyOperationRecord extends OperationBase {
  readonly id: string;
  readonly type: "colony";
  readonly parentId: EmpireOperationRecord["id"];
  readonly roomName: string;
}

export function getColonyOperationId(roomName: string): string {
  return `colony:${roomName}`;
}

export function createColonyOperation(roomName: string): ColonyOperationRecord {
  return {
    id: getColonyOperationId(roomName),
    type: "colony",
    parentId: "empire",
    roomName,
    status: "active",
  };
}

export const colonyOperationHandler: OperationHandler = {
  plan(): void {},
  execute(): void {},
};
