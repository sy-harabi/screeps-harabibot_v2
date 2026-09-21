import { getRoomCostMatrix } from "./capabilities/movement/roomCostMatrix"
import { run as runTraffic } from "./capabilities/movement/traffic"
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator"
import { runColonies } from "./colony/colonyManager"
import "./console/consoleApi"
import { createTickContext } from "./kernel/tickContext"
import { segmentManager } from "./persistence/segmentManager"
import "./visuals/roomVisual"

export function loop(): void {
  segmentManager.pretick()

  const context = createTickContext()

  runColonies(context)

  allocateSpawns()

  for (const room of Object.values(Game.rooms)) {
    runTraffic(room, () => getRoomCostMatrix(room.name))
  }

  segmentManager.endTick()
}
