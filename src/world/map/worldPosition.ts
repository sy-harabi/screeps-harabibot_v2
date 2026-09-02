import { parseRoomName } from "./roomName";

export interface RoomPositionLike {
  readonly x: number;
  readonly y: number;
  readonly roomName: string;
}

export interface WorldPosition {
  readonly x: number;
  readonly y: number;
}

export function toWorldPosition(position: RoomPositionLike): WorldPosition {
  const parsedRoomName = parseRoomName(position.roomName);

  const x = parsedRoomName.x * 50 + position.x;

  const y = parsedRoomName.y * 50 + position.y;

  return { x, y };
}

export function getWorldRange(
  first: RoomPositionLike,
  second: RoomPositionLike,
): number {
  const firstWorldPosition = toWorldPosition(first);
  const secondWorldPosition = toWorldPosition(second);

  return Math.max(
    Math.abs(firstWorldPosition.x - secondWorldPosition.x),
    Math.abs(firstWorldPosition.y - secondWorldPosition.y),
  );
}
