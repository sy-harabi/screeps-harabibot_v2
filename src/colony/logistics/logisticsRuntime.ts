import { runtimeRegistry } from "../../runtime/runtimeRegistry"

export interface LogisticsSupplierRuntime {
  targetRequestId?: string
  committed?: boolean
  committedAmount?: number
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

export function swapLogisticsSupplierRuntime(firstName: string, secondName: string): void {
  const first = getLogisticsSupplierRuntime(firstName)
  const second = getLogisticsSupplierRuntime(secondName)

  const firstTargetRequestId = first.targetRequestId
  const firstCommitted = first.committed
  const firstCommittedAmount = first.committedAmount

  first.targetRequestId = second.targetRequestId
  first.committed = second.committed
  first.committedAmount = second.committedAmount

  second.targetRequestId = firstTargetRequestId
  second.committed = firstCommitted
  second.committedAmount = firstCommittedAmount
}
