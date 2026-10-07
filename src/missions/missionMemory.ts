import type { RemoteDefenseMissionMemory } from "./remoteDefense/remoteDefenseMemory"

export type MissionMemory = RemoteDefenseMissionMemory

export type MissionType = MissionMemory["type"]

export type MissionOfType<T extends MissionType> = Extract<MissionMemory, { type: T }>
