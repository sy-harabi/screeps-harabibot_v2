import { packPath, unpackPath, type PackedPath } from "../../capabilities/movement/packedPath"

export interface HarvestSourcePlan {
  readonly path: readonly RoomPosition[]
}

export interface HarvestRoomPlan {
  readonly colonyName: string
  readonly basePlanRevision: number
  readonly sources: ReadonlyMap<Id<Source>, HarvestSourcePlan>
}

export type PackedHarvestRoomPlan = readonly [
  colonyName: string,
  basePlanRevision: number,
  sources: readonly (readonly [sourceId: Id<Source>, path: PackedPath])[],
]

export function packHarvestRoomPlan(plan: HarvestRoomPlan): PackedHarvestRoomPlan {
  return [
    plan.colonyName,
    plan.basePlanRevision,
    [...plan.sources].map(([sourceId, source]) => [sourceId, packPath(source.path)] as const),
  ]
}

export function unpackHarvestRoomPlan(packed: PackedHarvestRoomPlan): HarvestRoomPlan {
  return {
    colonyName: packed[0],
    basePlanRevision: packed[1],
    sources: new Map<Id<Source>, HarvestSourcePlan>(
      packed[2].map(([sourceId, packedPath]) => [sourceId, { path: unpackPath(packedPath) }]),
    ),
  }
}
