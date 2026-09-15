import {
  packBasePlan,
  unpackBasePlan,
} from "../../capabilities/basePlanning/basePlanCodec";
import { planBase } from "../../capabilities/basePlanning/planBase";
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

export const colonyOperationHandler: OperationHandler<ColonyOperationRecord> = {
  execute(operation, context): void {
    const { roomName } = operation;

    const terrain = Game.map.getRoomTerrain(roomName);

    const room = Game.rooms[roomName];

    if (!room || !room.controller || !room.controller.my) {
      return;
    }

    const sources = room.find(FIND_SOURCES);

    const minerals = room.find(FIND_MINERALS);

    let cpuBefore = Game.cpu.getUsed();

    const basePlan = planBase(
      roomName,
      terrain,
      room.controller,
      sources,
      minerals,
    );

    if (basePlan) {
      const packedBasePlan = packBasePlan(basePlan);
      const unpackedBasePlan = unpackBasePlan(packedBasePlan);
      console.log(
        JSON.stringify(basePlan) === JSON.stringify(unpackedBasePlan),
      );

      const rawSize = JSON.stringify(basePlan).length;
      const packedSize = JSON.stringify(packedBasePlan).length;

      console.log(
        `basePlan raw=${rawSize}, packed=${packedSize}, ratio=${packedSize / rawSize}`,
      );
    }

    console.log(Game.cpu.getUsed() - cpuBefore);
  },
};
