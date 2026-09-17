import { runtimeRegistry } from "./runtimeRegistry";

const creepHeap = runtimeRegistry.createCache<string, unknown>("creepHeap");

export function getCreepHeap<T extends object>(creepName: string): Partial<T> {
  let heap = creepHeap.get(creepName);

  if (heap === undefined) {
    heap = {};
    creepHeap.set(creepName, heap);
  }

  return heap as Partial<T>;
}

export function clearCreepRuntime(creepName: string): void {
  creepHeap.delete(creepName);
}
