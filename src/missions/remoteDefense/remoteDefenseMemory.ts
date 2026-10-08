import type { MissionBaseMemory } from "../mission"

export interface RemoteDefenseMissionMemory extends MissionBaseMemory<"remoteDefense"> {
  readonly colonyName: string
  currentTargetRoomName?: string
}
