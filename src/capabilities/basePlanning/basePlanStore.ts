import { segmentManager } from "../../persistence/segmentManager"
import { runtimeRegistry } from "../../runtime/runtimeRegistry"
import { BasePlan } from "./basePlan"
import { packBasePlan, PackedBasePlan, unpackBasePlan } from "./basePlanCodec"

interface BasePlanSegment {
  version: 1
  plans: Record<string, PackedBasePlan>
}

const BASE_PLAN_SEGMENT_IDS = [0, 1, 2, 3, 4, 5, 6, 7] as const

export type BasePlanReadResult = { status: "loading" } | { status: "missing" } | { status: "ready"; value: BasePlan }

const basePlanCache = runtimeRegistry.createCache<string, BasePlan>("basePlans")

export const basePlanStore = {
  get,
  set,
}

function set(roomName: string, plan: BasePlan): void {
  const segmentId = getBasePlanSegmentId(roomName)

  const result = segmentManager.getSegment<BasePlanSegment>(segmentId)

  if (result.status === "loading") {
    throw new Error(`Cannot save base plan before segment ${segmentId} is loaded`)
  }

  const segment =
    result.value.version === 1 && result.value.plans
      ? result.value
      : {
          version: 1 as const,
          plans: {},
        }

  segment.plans[roomName] = packBasePlan(plan)
  segmentManager.setSegment(segmentId, segment)

  basePlanCache.set(roomName, plan)
}

function get(roomName: string): BasePlanReadResult {
  const cached = basePlanCache.get(roomName)

  if (cached !== undefined) {
    return {
      status: "ready",
      value: cached,
    }
  }

  const segmentId = getBasePlanSegmentId(roomName)

  const segmentResult = segmentManager.getSegment<BasePlanSegment>(segmentId)

  if (segmentResult.status === "loading") {
    return { status: "loading" }
  }

  const plans = getPlans(segmentResult.value)

  const packed = plans[roomName]

  if (packed === undefined) {
    return { status: "missing" }
  }

  const plan = unpackBasePlan(packed)

  basePlanCache.set(roomName, plan)

  return {
    status: "ready",
    value: plan,
  }
}

function getPlans(segment: Partial<BasePlanSegment>): Record<string, PackedBasePlan> {
  return segment.version === 1 && segment.plans ? segment.plans : {}
}

function getBasePlanSegmentId(roomName: string): number {
  let hash = 0

  for (let i = 0; i < roomName.length; i++) {
    hash = (hash * 31 + roomName.charCodeAt(i)) >>> 0
  }

  return BASE_PLAN_SEGMENT_IDS[hash % BASE_PLAN_SEGMENT_IDS.length]
}
