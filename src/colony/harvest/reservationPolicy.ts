import type { RoomIntel } from "../../world/intel/roomIntel"
import type { HarvestRoomState, ReservationState } from "./harvestState"

const RESERVATION_RESTART_MARGIN = 200
const TARGET_RESERVE_POWER = 2

export function getReservationState(intel: RoomIntel, username: string): ReservationState {
  if (intel.controller?.owner?.username === username) {
    return "owned"
  }

  const reservation = intel.controller?.reservation

  if (reservation === undefined || reservation.endTick <= Game.time) {
    return "none"
  }

  return reservation.username === username ? "ours" : "foreign"
}

function getReservationTicks(roomState: HarvestRoomState): number {
  if (roomState.reservationState !== "ours") {
    return 0
  }

  const endTick = roomState.intel.controller?.reservation?.endTick

  return endTick === undefined ? 0 : Math.max(0, endTick - Game.time)
}

export function needsReserver(roomState: HarvestRoomState): boolean {
  const leadTime = roomState.reserverLeadTime

  if (leadTime === undefined || roomState.reservePower >= TARGET_RESERVE_POWER) {
    return false
  }

  return getReservationTicks(roomState) - leadTime < RESERVATION_RESTART_MARGIN
}

export function isReservationLifecycleActive(roomState: HarvestRoomState, firstSourceReady = false): boolean {
  if (roomState.reservationState === "ours" || roomState.hasReserver) {
    return true
  }

  if (roomState.reserverLeadTime === undefined) {
    return false
  }

  return roomState.reservationState === "foreign" || (roomState.reservationState === "none" && firstSourceReady)
}

export function getReservationUpkeep(roomState: HarvestRoomState): { energy: number; spawnUsage: number } {
  const travelTicks = roomState.controllerTravelTicks

  if (travelTicks === undefined) {
    return { energy: 0, spawnUsage: 0 }
  }

  const productiveLifetime = CREEP_CLAIM_LIFE_TIME - travelTicks

  if (productiveLifetime <= 0) {
    return { energy: 0, spawnUsage: 0 }
  }

  return {
    energy: 650 / productiveLifetime,
    spawnUsage: (TARGET_RESERVE_POWER * CREEP_SPAWN_TIME) / productiveLifetime,
  }
}
