import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import type { SourceEconomyStats } from "./sourceEconomyStats"

export interface HarvestRuntime {
  sourceEconomyStatsById?: Map<Id<Source>, SourceEconomyStats>
  remoteControllersByRoom?: Map<string, RemoteControllerRuntime>
  haulerTravelBySource?: Map<Id<Source>, HaulerTravelRuntime>
}

export interface HaulerTravelRuntime {
  // cache validity check
  readonly sourcePath: readonly RoomPosition[]

  // Both paths are stored colony -> source.
  readonly emptyPath: readonly RoomPosition[]
  readonly loadedPath: readonly RoomPosition[]

  readonly emptyTravelTicks: number
  readonly loadedTravelTicks: number
  readonly cycleTravelTicks: number
}

export interface RemoteControllerRuntime {
  readonly travelTicks: number
  readonly availablePositions: number
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
