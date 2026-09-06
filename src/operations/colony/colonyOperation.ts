import { distanceTransform } from "../../world/map/distanceTransform";
import { fromRoomIndex, ROOM_AREA } from "../../world/map/roomGrid";
import type { EmpireOperationRecord } from "../empire/empireOperation";
import { OperationBase } from "../operation";
import type { OperationHandler } from "../operationHandler";

export interface ColonyOperationRecord extends OperationBase {
  readonly id: string;
  readonly type: "colony";
  readonly parentId: EmpireOperationRecord["id"];
  readonly roomName: string;
}

export function getColonyOperationId(roomName: string): string {
  return `colony:${roomName}`;
}

export function createColonyOperation(roomName: string): ColonyOperationRecord {
  return {
    id: getColonyOperationId(roomName),
    type: "colony",
    parentId: "empire",
    roomName,
    status: "active",
  };
}

export const colonyOperationHandler: OperationHandler = {
  execute(operation: ColonyOperationRecord, context): void {
    const { roomName } = operation;

    const terrrain = Game.map.getRoomTerrain(roomName);

    const dt = distanceTransform(terrrain);

    const visual = new RoomVisual(roomName);
    for (let index = 0; index < ROOM_AREA; index++) {
      const coordinates = fromRoomIndex(index);
      const distance = dt[index];
      visual.text(`${distance}`, coordinates.x, coordinates.y);
    }
  },
};
