import { SpawnPriority } from "./spawnPriority";
import { RenewRequest, SpawnRequest } from "./spawnRequest";

export type SpawnJob =
  | {
      readonly type: "spawn";
      readonly request: SpawnRequest;
    }
  | {
      readonly type: "renew";
      readonly request: RenewRequest;
    };

function getSpawnJobPriority(job: SpawnJob): SpawnPriority {
  return job.request.priority;
}
