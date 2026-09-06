import { RoomCoordinate } from "../../world/map/roomCoordinate";
import type { BasePlan } from "./basePlan";

/**
 * Base planner entry point for the Screeps runtime.
 */
export function planBase(
  roomName: string,
  terrain: Uint8Array,
  controller: RoomCoordinate,
  sources: Readonly<Record<string, RoomCoordinate>>,
  mineral: RoomCoordinate,
): BasePlan {}
