import {
  createEmpireOperation,
  planEmpireOperation,
} from "./operations/empire/empireOperation";
import { ensureOperation } from "./operations/operationStore";
import "./visuals/roomVisual";

export function loop(): void {
  ensureOperation(createEmpireOperation());

  const ownedRooms = Object.values(Game.rooms).filter(
    (room) => room.controller?.my === true,
  );

  planEmpireOperation(ownedRooms);
}
