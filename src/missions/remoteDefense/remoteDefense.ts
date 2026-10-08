import type { TickContext } from "../../kernel/tickContext"
import type { MissionId } from "../mission"
import { missionStore } from "../missionStore"
import type { RemoteDefenseMissionMemory } from "./remoteDefenseMemory"
import { getRemoteDefenseState } from "./remoteDefenseState"

export function getRemoteDefenseMissionId(colonyName: string): MissionId {
  return `remoteDefense:${colonyName}`
}

export function ensureRemoteDefenseMission(colonyName: string): void {
  const missionId = getRemoteDefenseMissionId(colonyName)
  const existing = missionStore.get(missionId)

  if (existing !== undefined) {
    if (existing.type !== "remoteDefense") {
      throw new Error(`Mission ID collision: ${missionId}`)
    }

    existing.finishedAt = undefined
    return
  }

  missionStore.add(missionId, {
    type: "remoteDefense",
    colonyName,
    createdAt: Game.time,
  })
}

export function runRemoteDefenseMissions(context: TickContext): void {
  for (const [missionId, mission] of missionStore.getByType("remoteDefense")) {
    if (mission.finishedAt !== undefined) {
      if (mission.finishedAt < Game.time) {
        missionStore.remove(missionId)
      }

      continue
    }

    runRemoteDefenseMission(mission, context)
  }
}

function runRemoteDefenseMission(mission: RemoteDefenseMissionMemory, context: TickContext): void {
  if (!context.ownedRooms.has(mission.colonyName)) {
    mission.currentTargetRoomName = undefined
    mission.finishedAt = Game.time
    return
  }

  const state = getRemoteDefenseState(mission.colonyName)

  if (state === undefined || state.hostileCreepIds.size > 0) {
    return
  }

  mission.currentTargetRoomName = undefined
  mission.finishedAt = Game.time
}
