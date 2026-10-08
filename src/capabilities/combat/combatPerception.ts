import { CREEP_CAPABILITY, type CreepCapabilities } from "../../creeps/creepCapabilities"
import { creepIntelStore } from "../../world/intel/creepIntelStore"
import { createForceProfile, type ForceProfile } from "./forceProfile"

export function getForeignCombatForceProfile(roomName: string): ForceProfile {
  const capabilities: CreepCapabilities[] = []

  for (const id of creepIntelStore.getForeignCreepIds(roomName)) {
    const intel = creepIntelStore.get(id)

    if (intel === undefined || !isCombatant(intel.capabilities)) {
      continue
    }

    capabilities.push(intel.capabilities)
  }

  return createForceProfile(capabilities)
}

export function isCombatant(capabilities: CreepCapabilities): boolean {
  return (
    capabilities[CREEP_CAPABILITY.attack] > 0 ||
    capabilities[CREEP_CAPABILITY.rangedAttack] > 0 ||
    capabilities[CREEP_CAPABILITY.heal] > 0
  )
}

export function isRemoteThreat(capabilities: CreepCapabilities): boolean {
  return (
    isCombatant(capabilities) ||
    capabilities[CREEP_CAPABILITY.dismantle] > 0 ||
    capabilities[CREEP_CAPABILITY.carry] > 0 ||
    capabilities[CREEP_CAPABILITY.claim] > 0
  )
}
