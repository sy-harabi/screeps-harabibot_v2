import type { RoomCoordinate } from "../../world/map/roomCoordinate"
import { ROOM_AREA, toRoomIndex } from "../../world/map/roomGrid"
import type { PlannedStructure } from "./basePlan"
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates"
import type { CorePlan } from "./findCorePlans"

export const UPGRADE_TILE_NEVER_RELEASE_RCL = 9

export function buildUpgradeTileMinRclMask(controllerArea: ControllerAreaCandidate, corePlan: CorePlan): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)
  const { rcl7Chain, rcl8Chain, finalChain } = getUpgradeChainRoles(controllerArea, corePlan)

  markChain(mask, rcl7Chain, 7)
  markChain(mask, rcl8Chain, 8)

  const finalRoot = finalChain[0]

  if (finalRoot !== undefined) {
    mask[toRoomIndex(finalRoot.x, finalRoot.y)] = UPGRADE_TILE_NEVER_RELEASE_RCL
  }

  for (let index = 1; index < finalChain.length; index++) {
    const { x, y } = finalChain[index]
    mask[toRoomIndex(x, y)] = 8
  }

  return mask
}

export function blocksUpgradeTile(structureType: BuildableStructureConstant): boolean {
  return (
    structureType !== STRUCTURE_ROAD && structureType !== STRUCTURE_RAMPART && structureType !== STRUCTURE_CONTAINER
  )
}

export function applyUpgradeTileRclConstraints(
  structures: readonly PlannedStructure[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): PlannedStructure[] | undefined {
  const minRclMask = buildUpgradeTileMinRclMask(controllerArea, corePlan)
  const result: PlannedStructure[] = []

  for (const structure of structures) {
    if (!blocksUpgradeTile(structure.structureType)) {
      result.push(structure)
      continue
    }

    const { x, y } = structure.coordinate
    const minRcl = minRclMask[toRoomIndex(x, y)]

    if (minRcl === UPGRADE_TILE_NEVER_RELEASE_RCL) {
      return
    }

    if (minRcl > 0 && structure.rcl < minRcl) {
      result.push({ ...structure, rcl: minRcl })
      continue
    }

    result.push(structure)
  }

  return result
}

export function validateUpgradeTileRclConstraints(
  structures: readonly PlannedStructure[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): boolean {
  const minRclMask = buildUpgradeTileMinRclMask(controllerArea, corePlan)

  for (const structure of structures) {
    if (!blocksUpgradeTile(structure.structureType)) {
      continue
    }

    const { x, y } = structure.coordinate
    const minRcl = minRclMask[toRoomIndex(x, y)]

    if (minRcl === UPGRADE_TILE_NEVER_RELEASE_RCL) {
      return false
    }

    if (minRcl > 0 && structure.rcl < minRcl) {
      return false
    }
  }

  return true
}

function getUpgradeChainRoles(
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
): {
  readonly rcl7Chain: readonly RoomCoordinate[]
  readonly rcl8Chain: readonly RoomCoordinate[]
  readonly finalChain: readonly RoomCoordinate[]
} {
  const { left, middle, right } = controllerArea.upgradeChains
  const chains = [left, middle, right]
  const rcl7Chain = chains.find((chain) => isRoot(chain, corePlan.factory))
  const rcl8Chain = chains.find((chain) => isRoot(chain, corePlan.powerSpawn))

  if (!rcl7Chain || !rcl8Chain || rcl7Chain === rcl8Chain) {
    throw new Error("Core manager structures do not map to distinct upgrade-chain roots")
  }

  const shortestLength = Math.min(...chains.map((chain) => chain.length))

  if (rcl7Chain.length !== shortestLength) {
    throw new Error("Factory must occupy a shortest upgrade chain")
  }

  const finalChains = chains.filter((chain) => chain !== rcl7Chain && chain !== rcl8Chain)

  if (finalChains.length !== 1 || finalChains[0].length === 0) {
    throw new Error("Expected exactly one final upgrade chain")
  }

  return {
    rcl7Chain,
    rcl8Chain,
    finalChain: finalChains[0],
  }
}

function markChain(mask: Uint8Array, chain: readonly RoomCoordinate[], minRcl: number): void {
  for (const { x, y } of chain) {
    mask[toRoomIndex(x, y)] = minRcl
  }
}

function isRoot(chain: readonly RoomCoordinate[], coordinate: RoomCoordinate): boolean {
  const root = chain[0]

  return root !== undefined && root.x === coordinate.x && root.y === coordinate.y
}
