import { HARVEST_DATA_SEGMENT_IDS } from "../../persistence/segmentIds"
import type { PackedRemoteRoomData } from "./remoteRoomData"
import type { PackedSourceData } from "./sourceData"

export interface HarvestDataSegment {
  version: 2
  sources: Record<string, PackedSourceData>
  remotes: Record<string, PackedRemoteRoomData>
}

export function normalizeHarvestDataSegment(value: Partial<HarvestDataSegment>): HarvestDataSegment {
  if (
    value.version === 2 &&
    value.sources !== undefined &&
    value.sources !== null &&
    typeof value.sources === "object" &&
    value.remotes !== undefined &&
    value.remotes !== null &&
    typeof value.remotes === "object"
  ) {
    return value as HarvestDataSegment
  }

  return {
    version: 2,
    sources: {},
    remotes: {},
  }
}

export function getHarvestDataSegmentId(key: string): number {
  let hash = 0

  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }

  return HARVEST_DATA_SEGMENT_IDS[hash % HARVEST_DATA_SEGMENT_IDS.length]
}
