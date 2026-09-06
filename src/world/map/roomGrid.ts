import { RoomCoordinate } from "./roomCoordinate";

export const ROOM_SIZE = 50;
export const ROOM_AREA = ROOM_SIZE * ROOM_SIZE;

export const NEIGHBOR_OFFSETS: readonly RoomCoordinate[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export function isInsideRoom(x: number, y: number): boolean {
  return x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE;
}

export function toRoomIndex(x: number, y: number): number {
  return y * ROOM_SIZE + x;
}

export function fromRoomIndex(index: number): RoomCoordinate {
  return {
    x: index % ROOM_SIZE,
    y: Math.floor(index / ROOM_SIZE),
  };
}

export function forEachCoordinateInRange(
  center: RoomCoordinate,
  range: number,
  callback: (x: number, y: number) => void,
): void {
  const minX = Math.max(0, center.x - range);
  const maxX = Math.min(ROOM_SIZE - 1, center.x + range);
  const minY = Math.max(0, center.y - range);
  const maxY = Math.min(ROOM_SIZE - 1, center.y + range);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      callback(x, y);
    }
  }
}
