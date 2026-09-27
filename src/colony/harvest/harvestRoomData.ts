import { packPath, unpackPath, type PackedPath } from "../../capabilities/movement/packedPath"

export interface HarvestSourceData {
  readonly sourceId: Id<Source>
  readonly path: readonly RoomPosition[]
}

export interface HarvestRoomData {
  readonly colonyName: string
  readonly basePlanRevision: number
  readonly sources: readonly HarvestSourceData[]
}

export type PackedHarvestRoomData = readonly [
  colonyName: string,
  basePlanRevision: number,
  sources: readonly (readonly [sourceId: Id<Source>, path: PackedPath])[],
]

export function packHarvestRoomData(data: HarvestRoomData): PackedHarvestRoomData {
  return [
    data.colonyName,
    data.basePlanRevision,
    data.sources.map(({ sourceId, path }) => [sourceId, packPath(path)] as const),
  ]
}

export function unpackHarvestRoomData(packed: PackedHarvestRoomData): HarvestRoomData {
  return {
    colonyName: packed[0],
    basePlanRevision: packed[1],
    sources: packed[2].map(([sourceId, packedPath]) => ({ sourceId, path: unpackPath(packedPath) })),
  }
}
