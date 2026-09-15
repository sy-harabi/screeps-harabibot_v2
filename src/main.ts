import { createTickContext } from "./kernel/tickContext";
import {
  executeOperationTree,
  planOperationTree,
} from "./kernel/operationRunner";
import { createEmpireOperation } from "./operations/empire/empireOperation";
import { ensureOperation } from "./operations/operationStore";
import "./visuals/roomVisual";
import "./console/consoleApi";
import { segmentManager } from "./persistence/segmentManager";
import { allocateSpawns } from "./capabilities/spawning/spawnAllocator";

export function loop(): void {
  segmentManager.pretick();

  const context = createTickContext();
  const rootOperation = ensureOperation(createEmpireOperation());

  planOperationTree(rootOperation, context);

  allocateSpawns();

  executeOperationTree(rootOperation, context);

  segmentManager.endTick();
}
