import type { TickContext } from "../kernel/tickContext"
import type { OperationRecord } from "./operation"

export interface OperationHandler<T extends OperationRecord> {
  plan?(operation: T, context: TickContext): void
  execute?(operation: T, context: TickContext): void
}
