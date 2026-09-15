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

export function loop(): void {
  segmentManager.pretick();

  const context = createTickContext();
  const rootOperation = ensureOperation(createEmpireOperation());

  planOperationTree(rootOperation, context);

  // Shared-resource allocators run here as they are introduced.

  executeOperationTree(rootOperation, context);

  segmentManager.endTick();
}
