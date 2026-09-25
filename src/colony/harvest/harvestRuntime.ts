import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { SourceEconomy } from "./sourceEconomy"

export interface HarvestRuntime {
  sourceOrder?: Id<Source>[]
  sourceEconomyById?: Map<Id<Source>, SourceEconomy>
}

const harvestRuntimes = runtimeRegistry.createCache<string, HarvestRuntime>("harvest.colonies", {
  cleanupInterval: 500,
  cleanup: (runtimes) => {
    for (const colonyName of runtimes.keys()) {
      if (Game.rooms[colonyName]?.controller?.my !== true) {
        runtimes.delete(colonyName)
      }
    }
  },
})

export function getHarvestRuntime(colonyName: string): HarvestRuntime {
  let runtime = harvestRuntimes.get(colonyName)

  if (runtime === undefined) {
    runtime = {}
    harvestRuntimes.set(colonyName, runtime)
  }

  return runtime
}

export function invalidateHarvestRuntime(colonyName: string): void {
  harvestRuntimes.delete(colonyName)
}
