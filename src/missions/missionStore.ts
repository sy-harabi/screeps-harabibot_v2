import type { MissionId } from "./mission"
import type { MissionMemory, MissionOfType, MissionType } from "./missionMemory"

export interface MissionEntry<T extends MissionMemory = MissionMemory> {
  readonly id: MissionId
  readonly mission: T
}

let preparedTick = -1

const missionsByType = new Map<MissionType, MissionEntry[]>()
const childrenByParent = new Map<MissionId, MissionEntry[]>()

export const missionStore = {
  prepare,
  get,
  getByType,
  getChildren,
  add,
  remove,
}

function add(id: MissionId, mission: MissionMemory): void {
  const missions = getMissionMemory()

  if (missions[id] !== undefined) {
    throw new Error(`Mission already exists: ${id}`)
  }

  missions[id] = mission
}

function remove(id: MissionId): void {
  delete getMissionMemory()[id]
}

function getChildren(parentId: MissionId): readonly MissionEntry[] {
  assertPrepared()

  return childrenByParent.get(parentId) ?? []
}

function getByType<T extends MissionType>(type: T): readonly MissionEntry<MissionOfType<T>>[] {
  assertPrepared()

  return (missionsByType.get(type) ?? []) as unknown as readonly MissionEntry<MissionOfType<T>>[]
}

function get(id: MissionId): MissionMemory | undefined {
  return getMissionMemory()[id]
}

function getMissionMemory(): Record<MissionId, MissionMemory> {
  return (Memory.missions ??= {})
}

function assertPrepared(): void {
  if (preparedTick !== Game.time) {
    throw new Error("Mission state is not prepared for this tick")
  }
}

function prepare(): void {
  if (preparedTick === Game.time) {
    return
  }

  preparedTick = Game.time

  missionsByType.clear()
  childrenByParent.clear()

  for (const [id, mission] of Object.entries(getMissionMemory())) {
    const entry: MissionEntry = {
      id,
      mission,
    }

    let byType = missionsByType.get(mission.type)

    if (byType === undefined) {
      byType = []
      missionsByType.set(mission.type, byType)
    }

    byType.push(entry)

    if (mission.parentId === undefined) {
      continue
    }

    let children = childrenByParent.get(mission.parentId)

    if (children === undefined) {
      children = []
      childrenByParent.set(mission.parentId, children)
    }

    children.push(entry)
  }
}
