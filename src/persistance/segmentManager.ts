export type SegmentResult<T> =
  { status: "loading" } | { status: "ready"; value: T };

const MAX_ACTIVE_SEGMENTS = 10;

const loadedSegments = new Map<number, unknown>();
const requestedSegments = new Set<number>();
const dirtySegments = new Map<number, unknown>();

export const segmentManager = {
  pretick,
  getSegment,
  setSegment,
  endTick,
};

export function pretick(): void {
  for (const [idString, raw] of Object.entries(RawMemory.segments)) {
    const id = Number(idString);

    loadedSegments.set(id, raw.length === 0 ? {} : JSON.parse(raw));
  }

  requestedSegments.clear();
}
export function getSegment<T>(id: number): SegmentResult<T> {
  assertValidSegmentId(id);

  if (loadedSegments.has(id)) {
    return { status: "ready", value: loadedSegments.get(id) as T };
  }

  requestSegment(id);

  return {
    status: "loading",
  };
}
export function setSegment<T>(id: number, value: T): void {
  assertValidSegmentId(id);

  loadedSegments.set(id, value);
  dirtySegments.set(id, value);
}

export function endTick(): void {
  RawMemory.setActiveSegments([...requestedSegments]);

  for (const [id, value] of dirtySegments) {
    RawMemory.segments[id] = JSON.stringify(value);
  }

  dirtySegments.clear();
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
