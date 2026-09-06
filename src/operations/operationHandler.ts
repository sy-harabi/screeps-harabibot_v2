import type { TickContext } from "../kernel/tickContext";
import type { OperationRecord } from "./operation";

export interface OperationHandler {
  plan?(operation: OperationRecord, context: TickContext): void;
  execute?(operation: OperationRecord, context: TickContext): void;
}
