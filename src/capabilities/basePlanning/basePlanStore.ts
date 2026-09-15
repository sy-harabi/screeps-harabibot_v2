import { segmentManager } from "../../persistence/segmentManager";
import { runtimeRegistry } from "../../runtime/runtimeRegisty";
import { BasePlan } from "./basePlan";
import { PackedBasePlan, unpackBasePlan } from "./basePlanCodec";

const basePlanCache = runtimeRegistry.createCache<string, BasePlan>(
  "basePlans",
);

interface BasePlanSegment {
  version: 1;
  plans: Record<string, PackedBasePlan>;
}

const BASE_PLAN_SEGMENT_IDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export type BasePlanReadResult =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; value: BasePlan };

export const basePlanStore = {
  get,
  set,
  delete: deleteBasePlan,
};

function deleteBasePlan(roomName: string): void {}

function set(roomName: string, plan: BasePlan): void {}

function get(roomName: string): BasePlanReadResult {
  const cached = basePlanCache.get(roomName);

  if (cached !== undefined) {
    return {
      status: "ready",
      value: cached,
    };
  }

  const segmentId = getBasePlanSegmentId(roomName);

  const segmentResult = segmentManager.getSegment<BasePlanSegment>(segmentId);

  if (segmentResult.status === "loading") {
    return { status: "loading" };
  }

  const packed = segmentResult.value.plans?.[roomName];

  if (packed === undefined) {
    return { status: "missing" };
  }

  const plan = unpackBasePlan(packed);

  basePlanCache.set(roomName, plan);

  return {
    status: "ready",
    value: plan,
  };
}

function getBasePlanSegmentId(roomName: string): number {
  let hash = 0;

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0;
  }

  return BASE_PLAN_SEGMENT_IDS[hash % BASE_PLAN_SEGMENT_IDS.length];
}
