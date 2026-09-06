import { distanceTransform } from "../../world/map/distanceTransform";
import { fromRoomIndex, ROOM_AREA } from "../../world/map/roomGrid";
import type { BasePlan, PlannedStructure } from "./basePlan";

/**
 * Base planner entry point for the Screeps runtime.
 */
export function planBase(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  mineral: Mineral[],
): BasePlan {
  const dt = distanceTransform(terrain);

  const visual = new RoomVisual(roomName);
  for (let index = 0; index < ROOM_AREA; index++) {
    const coordinates = fromRoomIndex(index);
    const distance = dt[index];
    visual.text(`${distance}`, coordinates.x, coordinates.y);
  }

  const structures: PlannedStructure[] = [];
  const anchor = { x: 25, y: 25 };

  return { version: 1, roomName, anchor, structures };
}
