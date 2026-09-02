import type { OperationsMemory } from "./operations/operation";

declare global {
  interface Memory {
    operations?: OperationsMemory;
  }
}

export {};
