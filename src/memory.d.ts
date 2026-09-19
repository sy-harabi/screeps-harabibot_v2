import type { OperationsMemory } from "./operations/operation"
import type { BotOptionsOverride } from "./options/botOptions"

declare global {
  interface Memory {
    operations?: OperationsMemory
    options?: BotOptionsOverride
  }

  interface CreepMemory {
    operationId: string
    role: string
    sourceId?: Id<Source>
  }
}
