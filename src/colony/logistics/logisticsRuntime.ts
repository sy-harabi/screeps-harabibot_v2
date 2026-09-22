import { runtimeRegistry } from "../../runtime/runtimeRegistry"

export interface LogisticsSupplierRuntime {
  targetRequestId?: string
  committed?: boolean
}

const supplierRuntimes = runtimeRegistry.createCache<string, LogisticsSupplierRuntime>("logistics.suppliers", {
  cleanupInterval: 100,
  cleanup: (runtimes) => {
    for (const creepName of runtimes.keys()) {
      if (Game.creeps[creepName] === undefined) {
        runtimes.delete(creepName)
      }
    }
  },
})

export function getLogisticsSupplierRuntime(creepName: string): LogisticsSupplierRuntime {
  let runtime = supplierRuntimes.get(creepName)

  if (runtime === undefined) {
    runtime = {}
    supplierRuntimes.set(creepName, runtime)
  }

  return runtime
}
