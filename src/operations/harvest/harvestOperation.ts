import type { TickContext } from "../../kernel/tickContext"
import type { ColonyOperationRecord } from "../colony/colonyOperation"
import type { OperationBase } from "../operation"
import type { OperationHandler } from "../operationHandler"
import { planMiners, runMiners } from "./miner"

export interface HarvestOperationRecord extends OperationBase {
  readonly id: string
  readonly type: "harvest"
  readonly parentId: ColonyOperationRecord["id"]
  readonly roomName: string
}

export function getHarvestOperationId(roomName: string): string {
  return `harvest:${roomName}`
}

export function createHarvestOperation(
  parentId: ColonyOperationRecord["id"],
  roomName: string,
): HarvestOperationRecord {
  return {
    id: getHarvestOperationId(roomName),
    type: "harvest",
    parentId,
    roomName,
    status: "active",
  }
}

export const harvestOperationHandler: OperationHandler<HarvestOperationRecord> = {
  plan(operation: HarvestOperationRecord, context: TickContext): void {
    planMiners(operation, context)
  },

  execute(operation: HarvestOperationRecord, context: TickContext): void {
    runMiners(operation, context)
  },
}
