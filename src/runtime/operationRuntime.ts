// operationRuntime.ts

import { runtimeRegistry } from "./runtimeRegistry";

const operationHeap = runtimeRegistry.createCache<string, unknown>(
  "operationHeap",
);

let tempTick = -1;
const operationTemp = new Map<string, unknown>();

export function getOperationHeap<T extends object>(
  operationId: string,
): Partial<T> {
  let heap = operationHeap.get(operationId);

  if (heap === undefined) {
    heap = {};
    operationHeap.set(operationId, heap);
  }

  return heap as Partial<T>;
}

export function getOperationTemp<T extends object>(
  operationId: string,
): Partial<T> {
  prepareTemp();

  let temp = operationTemp.get(operationId);

  if (temp === undefined) {
    temp = {};
    operationTemp.set(operationId, temp);
  }

  return temp as Partial<T>;
}

function prepareTemp(): void {
  if (tempTick === Game.time) return;

  tempTick = Game.time;
  operationTemp.clear();
}

export function clearOperationRuntime(operationId: string): void {
  operationHeap.delete(operationId);
}
