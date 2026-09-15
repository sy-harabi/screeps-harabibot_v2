export interface TickContext {
  readonly tick: number;
  readonly ownedRooms: ReadonlyMap<string, Room>;
}

let currentContext: TickContext | undefined;

export function createTickContext(): TickContext {
  const ownedRooms = new Map<string, Room>();

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my === true) {
      ownedRooms.set(room.name, room);
    }
  }

  const context: TickContext = {
    tick: Game.time,
    ownedRooms,
  };

  currentContext = context;

  return context;
}

export function getTickContext(): TickContext {
  if (currentContext === undefined || currentContext.tick !== Game.time) {
    throw new Error("TickContext is not initialized for this tick");
  }

  return currentContext;
}
