import type { MissionId } from "./mission"
import type { MissionMemory, MissionOfType, MissionType } from "./missionMemory"

let preparedTick = -1

const missionsByType = new Map<MissionType, Map<MissionId, MissionMemory>>()
const childrenByParent = new Map<MissionId, Map<MissionId, MissionMemory>>()

const EMPTY_MISSIONS: ReadonlyMap<MissionId, MissionMemory> = new Map()

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

function getChildren(parentId: MissionId): ReadonlyMap<MissionId, MissionMemory> {
  assertPrepared()

  return childrenByParent.get(parentId) ?? EMPTY_MISSIONS
}
function getByType<T extends MissionType>(type: T): ReadonlyMap<MissionId, MissionOfType<T>> {
  assertPrepared()

  return (missionsByType.get(type) ?? EMPTY_MISSIONS) as ReadonlyMap<MissionId, MissionOfType<T>>
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
    let byType = missionsByType.get(mission.type)

    if (byType === undefined) {
      byType = new Map()
      missionsByType.set(mission.type, byType)
    }

    byType.set(id, mission)

    if (mission.parentId === undefined) {
      continue
    }

    let children = childrenByParent.get(mission.parentId)

    if (children === undefined) {
      children = new Map()
      childrenByParent.set(mission.parentId, children)
    }

    children.set(id, mission)
  }
}
