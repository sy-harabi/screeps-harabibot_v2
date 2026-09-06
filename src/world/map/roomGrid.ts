import { RoomCoordinate } from "./roomCoordinate";

export const ROOM_SIZE = 50;
export const ROOM_AREA = ROOM_SIZE * ROOM_SIZE;

export function toRoomIndex(x: number, y: number): number {
  return y * ROOM_SIZE + x;
}

export function fromRoomIndex(index: number): RoomCoordinate {
  return {
    x: index % ROOM_SIZE,
    y: Math.floor(index / ROOM_SIZE),
  };
}
