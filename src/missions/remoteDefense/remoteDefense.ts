import { TickContext } from "../../kernel/tickContext"
import { missionStore } from "../missionStore"
import { RemoteDefenseMissionMemory } from "./remoteDefenseMemory"

export function runRemoteDefenseMissions(context: TickContext): void {
  for (const [missionId, mission] of missionStore.getByType("remoteDefense")) {
    if (mission.finishedAt !== undefined) {
      if (mission.finishedAt < Game.time) {
        missionStore.remove(missionId)
      }

      continue
    }

    runRemoteDefenseMission(missionId, mission, context)
  }
}

function runRemoteDefenseMission(missionId: string, mission: RemoteDefenseMissionMemory, context: TickContext): void {
  // 아직 비워둠
}
