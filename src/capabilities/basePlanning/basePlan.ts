import { RoomCoordinate } from "../../world/map/roomCoordinate"

export type PlannedStructureTag =
  | { readonly kind: "storage" | "controller" }
  | { readonly kind: "source"; readonly id: Id<Source> }
  | { readonly kind: "mineral"; readonly id: Id<Mineral> }

export interface PlannedStructure {
  readonly structureType: StructureConstant
  readonly coordinate: RoomCoordinate
  readonly rcl: number
  readonly tag?: PlannedStructureTag
}

export interface BasePlan {
  readonly version: 1
  readonly roomName: string
  readonly anchor: RoomCoordinate
  readonly structures: PlannedStructure[]
}
