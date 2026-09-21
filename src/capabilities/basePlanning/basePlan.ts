import { RoomCoordinate } from "../../world/map/roomCoordinate"

export type PlannedStructureTag =
  | { readonly kind: "storage" | "controller" | "labInput" | "labOutput" }
  | { readonly kind: "source"; readonly id: Id<Source> }
  | { readonly kind: "mineral"; readonly id: Id<Mineral> }

export interface PlannedStructure {
  readonly structureType: StructureConstant
  readonly coordinate: RoomCoordinate
  readonly rcl: number
  readonly tag?: PlannedStructureTag
}

export interface BasePlanCore {
  readonly manager: RoomCoordinate
  readonly parking: readonly RoomCoordinate[]
}

export interface BasePlanUpgradeChains {
  readonly left: readonly RoomCoordinate[]
  readonly middle: readonly RoomCoordinate[]
  readonly right: readonly RoomCoordinate[]
}

export interface BasePlanController {
  readonly upgradeChains: BasePlanUpgradeChains
}

export interface BasePlan {
  readonly version: 1
  readonly roomName: string
  readonly anchor: RoomCoordinate
  readonly structures: PlannedStructure[]

  readonly core: BasePlanCore
  readonly controller: BasePlanController
}
