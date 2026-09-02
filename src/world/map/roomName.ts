export interface WorldRoomCoordinate {
  x: number;
  y: number;
}

export function parseRoomName(roomName: string): WorldRoomCoordinate {
  const match = /^([EW])(0|[1-9]\d*)([NS])(0|[1-9]\d*)$/i.exec(roomName);

  if (!match) {
    throw new Error(`Invalid room name: ${roomName}`);
  }

  const [, horizontalDir, xText, verticalDir, yText] = match;

  let x = Number(xText);
  let y = Number(yText);

  if (horizontalDir.toUpperCase() === "W") {
    x = -x - 1;
  }

  if (verticalDir.toUpperCase() === "N") {
    y = -y - 1;
  }

  return { x, y };
}

export function formatRoomName(coordinate: WorldRoomCoordinate): string {
  let { x, y } = coordinate;

  let roomName = "";

  if (x < 0) {
    roomName += `W${-x - 1}`;
  } else {
    roomName += `E${x}`;
  }

  if (y < 0) {
    roomName += `N${-y - 1}`;
  } else {
    roomName += `S${y}`;
  }

  return roomName;
}
