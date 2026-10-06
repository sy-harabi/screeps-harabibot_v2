import type { RoomIntel } from "../../world/intel/roomIntel"
import type { HaulerTravelRuntime } from "./harvestRuntime"

export type ReservationState = "owned" | "none" | "ours" | "foreign"

export interface HarvestRoomState {
  readonly roomName: string
  readonly intel: RoomIntel
  readonly sources: HarvestSourceState[]

  readonly reservationState: ReservationState
  readonly controllerTravelTicks?: number
  readonly reserverLeadTime?: number

  reservePower: number
  hasReserver: boolean
}

export interface HarvestSourceState {
  readonly id: Id<Source>
  readonly roomName: string

  readonly path: readonly RoomPosition[]
  readonly haulerTravel: HaulerTravelRuntime
  readonly useRoadPath: boolean
  readonly haulerCycleTravelTicks: number
  readonly miningPositions: readonly RoomPosition[]

  readonly requiredHarvestPower: number
  readonly requiredCarryCapacity: number
  readonly sourceObject?: Source
  readonly container?: StructureContainer
  readonly containerEnergy: number
  readonly droppedEnergy: number
  readonly largestDroppedEnergy?: Resource<ResourceConstant>

  sustainableHarvestPower: number
  activeHarvestPower: number
  numMiners: number

  remoteBuilderWorkNeeded?: number
  remoteConstructionTarget?: RoomPosition

  builderCarryEquivalent?: number
  remoteBuilderCarryCapacity?: number
  remoteRepairerCarryCapacity?: number
}

export type HaulTask =
  | {
      sourceId: Id<Source>
      phase: "outbound"
    }
  | {
      sourceId: Id<Source>
      phase: "loading"
      loadingSince: number
    }
  | {
      sourceId: Id<Source>
      phase: "inbound"
    }

export type HaulerProfile = "1:1" | "2:1"

interface HaulSourceTickState {
  pendingEnergy: number
  haulerCount: number
}

export type HaulTickState = Map<Id<Source>, HaulSourceTickState>

export interface HaulerSpeedrunState {
  readonly travelingMiners: Creep[]
}

export interface HaulingTickContext {
  readonly haulers: readonly Creep[]
  readonly sourceStates: readonly HarvestSourceState[]
  readonly sourceById: ReadonlyMap<Id<Source>, HarvestSourceState>
  readonly haulTickState: HaulTickState
  readonly speedrun?: HaulerSpeedrunState
}

export interface HarvestResult {
  readonly income: number
  readonly maxIncome: number
  readonly spawnUsage: number
  readonly activeSourcePaths?: readonly (readonly RoomPosition[])[]
  readonly hauling?: HaulingTickContext
}
