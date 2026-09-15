import { createTickContext } from "./kernel/tickContext";
import {
  executeOperationTree,
  planOperationTree,
} from "./kernel/operationRunner";
import { createEmpireOperation } from "./operations/empire/empireOperation";
import { ensureOperation } from "./operations/operationStore";
import "./visuals/roomVisual";
import "./console/consoleApi";
import { segmentManager } from "./persistance/segmentManager";

export function loop(): void {
  segmentManager.pretick();

  const context = createTickContext();
  const rootOperation = ensureOperation(createEmpireOperation());

  planOperationTree(rootOperation, context);

  // Shared-resource allocators run here as they are introduced.

  executeOperationTree(rootOperation, context);

  const result = segmentManager.getSegment<Record<string, unknown>>(0);

  if (result.status === "ready") {
    if (!result.value.hello) {
      segmentManager.setSegment(0, {
        hello: Game.time,
      });
    }
  }

  console.log(result.status);

  segmentManager.endTick();
}
