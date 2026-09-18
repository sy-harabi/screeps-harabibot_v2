import { createTickContext } from "./kernel/tickContext"
import { executeOperationTree, planOperationTree } from "./kernel/operationRunner"
import { createEmpireOperation } from "./operations/empire/empireOperation"
import { ensureOperation } from "./operations/operation"
import "./visuals/roomVisual"
import "./console/consoleApi"
import { segmentManager } from "./persistence/segmentManager"
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator"
import { run as runTraffic } from "./capabilities/movement/traffic"
import { getRoomCostMatrix } from "./capabilities/movement/roomCostMatrix"

export function loop(): void {
  segmentManager.pretick()

  const context = createTickContext()
  const rootOperation = ensureOperation(createEmpireOperation())

  planOperationTree(rootOperation, context)

  allocateSpawns()

  executeOperationTree(rootOperation, context)

  for (const room of Object.values(Game.rooms)) {
    runTraffic(room, () => getRoomCostMatrix(room.name))
  }

  segmentManager.endTick()
}
