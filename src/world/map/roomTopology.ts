import { parseRoomName } from "./roomName";

export type RoomType = "highway" | "normal" | "center" | "keeper";

export function getRoomType(roomName: string): RoomType {
  const { x, y } = parseRoomName(roomName);

  let xIndex = x >= 0 ? x : -x - 1;
  let yIndex = y >= 0 ? y : -y - 1;

  xIndex = xIndex % 10;
  yIndex = yIndex % 10;

  if (xIndex === 0 || yIndex === 0) {
    return "highway";
  }

  if (xIndex === 5 && yIndex === 5) {
    return "center";
  }

  if (xIndex > 3 && xIndex < 7 && yIndex > 3 && yIndex < 7) {
    return "keeper";
  }

  return "normal";
}
