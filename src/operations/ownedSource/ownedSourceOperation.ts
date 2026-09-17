import { TickContext } from "../../kernel/tickContext"
import type { ColonyOperationRecord } from "../colony/colonyOperation"
import type { OperationBase } from "../operation"
import { OperationHandler } from "../operationHandler"
import { planMiner, runMiners } from "./miner"

export const ownedSourceOperationHandler: OperationHandler<OwnedSourceOperationRecord> = {
  plan(operation: OwnedSourceOperationRecord, context: TickContext): void {
    planMiner(operation, context)
  },

  execute(operation: OwnedSourceOperationRecord, context: TickContext): void {
    runMiners(operation, context)
  },
}
export interface OwnedSourceOperationRecord extends OperationBase {
  readonly id: string
  readonly type: "ownedSource"
  readonly parentId: ColonyOperationRecord["id"]
  readonly roomName: string
  readonly sourceId: Id<Source>
}

export function createOwnedSourceOperation(
  parentId: ColonyOperationRecord["id"],
  roomName: string,
  sourceId: Id<Source>,
): OwnedSourceOperationRecord {
  return {
    id: getOwnedSourceOperationId(sourceId),
    type: "ownedSource",
    parentId,
    roomName,
    sourceId,
    status: "active",
  }
}

export function getOwnedSourceOperationId(sourceId: Id<Source>): string {
  return `ownedSource:${sourceId}`
}
