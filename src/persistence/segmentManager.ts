export type SegmentReadResult<T> =
  | { status: "loading" }
  | { status: "ready"; value: T };

const MAX_ACTIVE_SEGMENTS = 10;

const loadedSegments = new Map<number, unknown>();
const requestedSegments = new Set<number>();
const dirtySegments = new Set<number>();

function pretick(): void {
  requestedSegments.clear();

  for (const [idString, raw] of Object.entries(RawMemory.segments)) {
    const id = Number(idString);

    loadedSegments.set(id, raw.length === 0 ? {} : JSON.parse(raw));

    // Served segments are already cached in heap for this global lifetime.
    // Removing the per-tick RawMemory key frees the segment write budget without
    // deleting the server-side segment value.
    delete RawMemory.segments[id];
  }
}

function getSegment<T>(id: number): SegmentReadResult<T> {
  assertValidSegmentId(id);

  if (loadedSegments.has(id)) {
    return {
      status: "ready",
      value: loadedSegments.get(id) as T,
    };
  }

  requestSegment(id);

  return { status: "loading" };
}

function setSegment<T>(id: number, value: T): void {
  assertValidSegmentId(id);

  loadedSegments.set(id, value);
  dirtySegments.add(id);
}

function endTick(): void {
  RawMemory.setActiveSegments([...requestedSegments]);

  let usedWriteSlots = Object.keys(RawMemory.segments).length;

  for (const id of dirtySegments) {
    const alreadyQueued = Object.prototype.hasOwnProperty.call(
      RawMemory.segments,
      id,
    );

    if (!alreadyQueued && usedWriteSlots >= MAX_ACTIVE_SEGMENTS) {
      break;
    }

    if (!loadedSegments.has(id)) {
      throw new Error(`Dirty segment ${id} is not loaded`);
    }

    RawMemory.segments[id] = JSON.stringify(loadedSegments.get(id));
    dirtySegments.delete(id);

    if (!alreadyQueued) {
      usedWriteSlots++;
    }
  }
}

function requestSegment(id: number): void {
  if (requestedSegments.has(id)) {
    return;
  }

  if (requestedSegments.size >= MAX_ACTIVE_SEGMENTS) {
    throw new Error("Too many segment activation requests");
  }

  requestedSegments.add(id);
}

function assertValidSegmentId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 99) {
    throw new Error(`Invalid segment id: ${id}`);
  }
}

export const segmentManager = {
  pretick,
  getSegment,
  setSegment,
  endTick,
};
