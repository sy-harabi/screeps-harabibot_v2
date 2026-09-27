import { basePlanStore } from "./capabilities/basePlanning/basePlanStore"
import { getBaseRoomCostMatrix } from "./capabilities/movement/roomCostMatrix"
import { run as runTraffic } from "./capabilities/movement/traffic"
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator"
import { runColonies } from "./colony/colonyManager"
import { harvestRoomPlanStore } from "./colony/harvest/harvestRoomPlanStore"
import { considerRemoteHarvest } from "./colony/harvest/harvestRoomPlanner"
import "./console/consoleApi"
import { createTickContext } from "./kernel/tickContext"
import { segmentManager } from "./persistence/segmentManager"
import { runtimeRegistry } from "./runtime/runtimeRegistry"
import { runScouting } from "./scouting/scouting"
import { runTest } from "./test"
import "./visuals/roomVisual"
import { intelStore } from "./world/intel/intelStore"

export function loop(): void {
  segmentManager.pretick()

  const context = createTickContext()

  basePlanStore.pretick(context.ownedRooms.values())
  harvestRoomPlanStore.pretick()
  intelStore.pretick()

  if (intelStore.isReady()) {
    for (const room of Object.values(Game.rooms)) {
      const newStaticIntel = intelStore.observe(room)

      if (!newStaticIntel || !harvestRoomPlanStore.isReady()) {
        continue
      }

      considerRemoteHarvest(room.name, context)
    }
  }

  runScouting(context)

  if (intelStore.isReady() && harvestRoomPlanStore.isReady()) {
    runColonies(context)
  }

  allocateSpawns()

  for (const room of Object.values(Game.rooms)) {
    runTraffic(room, () => getBaseRoomCostMatrix(room.name))
  }

  runTest()

  runtimeRegistry.cleanup()
  segmentManager.endTick()
}
