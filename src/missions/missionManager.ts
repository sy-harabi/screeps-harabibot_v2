import { TickContext } from "../kernel/tickContext"
import { runRemoteDefenseMissions } from "./remoteDefense/remoteDefense"

export function runMissions(context: TickContext): void {
  runRemoteDefenseMissions(context)
}
