import { basePlanStore } from "./capabilities/basePlanning/basePlanStore"
import { getBaseRoomCostMatrix } from "./capabilities/movement/roomCostMatrix"
import { run as runTraffic } from "./capabilities/movement/traffic"
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator"
import { runColonies } from "./colony/colonyManager"
import { initializeRemoteRoom } from "./colony/harvest/remoteMining"
import { sourceDataStore } from "./colony/harvest/sourceDataStore"
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
  sourceDataStore.pretick()
  intelStore.pretick()

  if (intelStore.isReady()) {
    for (const room of Object.values(Game.rooms)) {
      if (intelStore.observe(room)) {
        initializeRemoteRoom(room.name, context)
      }
    }
  }

  runScouting(context)

  runColonies(context)

  allocateSpawns()

  for (const room of Object.values(Game.rooms)) {
    runTraffic(room, () => getBaseRoomCostMatrix(room.name))
  }

  runTest()

  runtimeRegistry.cleanup()
  segmentManager.endTick()
}
