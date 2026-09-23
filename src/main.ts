import { basePlanStore } from "./capabilities/basePlanning/basePlanStore"
import { getBaseRoomCostMatrix } from "./capabilities/movement/roomCostMatrix"
import { run as runTraffic } from "./capabilities/movement/traffic"
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator"
import { runColonies } from "./colony/colonyManager"
import { sourceDataStore } from "./colony/harvest/sourceDataStore"
import "./console/consoleApi"
import { createTickContext } from "./kernel/tickContext"
import { segmentManager } from "./persistence/segmentManager"
import { runtimeRegistry } from "./runtime/runtimeRegistry"
import "./visuals/roomVisual"
import { intelStore } from "./world/intel/intelStore"

export function loop(): void {
  segmentManager.pretick()

  const context = createTickContext()

  basePlanStore.pretick(context.ownedRooms.values())
  sourceDataStore.pretick(context.ownedRooms.values())
  intelStore.pretick()

  if (intelStore.isReady()) {
    for (const room of Object.values(Game.rooms)) {
      intelStore.observe(room)
    }
  }

  runColonies(context)

  allocateSpawns()

  for (const room of Object.values(Game.rooms)) {
    runTraffic(room, () => getBaseRoomCostMatrix(room.name))
  }

  runtimeRegistry.cleanup()
  segmentManager.endTick()
}
