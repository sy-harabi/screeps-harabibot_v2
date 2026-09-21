import { distanceTransform } from "../../world/map/distanceTransform"
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate"
import { fromRoomIndex, ROOM_AREA, toRoomIndex } from "../../world/map/roomGrid"
import { findTerrainRegions, TerrainRegion } from "../../world/map/terrainRegions"
import type { BasePlan } from "./basePlan"
import { classifyDefensiveTiles } from "./classifyDefensiveTiles"
import { buildProvisionalBasePlanStructures, finalizeBasePlanStructures } from "./finalizeBasePlan"
import { finalizeDefensePlan } from "./finalizeDefensePlan"
import { ControllerAreaCandidate, findControllerAreaCandidates } from "./findControllerAreaCandidates"
import { CorePlan, findCorePlans } from "./findCorePlans"
import { planLabs } from "./planLabs"
import { planOuterRampartRoads } from "./planOuterRampartRoads"
import { planOuterRamparts } from "./planOuterRamparts"
import { planResourceTree } from "./planResourceTree"
import { planStructureSlots } from "./planStructureSlots"
import { planTowers } from "./planTowers"
import { createBaseRegionSelection } from "./selectBaseRegions"

export interface PlanBaseOptions {
  readonly visualizeIntermediate?: boolean
  readonly existingSpawn?: RoomCoordinate
}

/**
 * Base planner entry point for the Screeps runtime.
 *
 * Intermediate planning visuals are disabled by default. The final successful
 * base plan is always visualized.
 */
export function planBase(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  minerals: Mineral[],
  options: PlanBaseOptions = {},
): BasePlan | undefined {
  const distances = distanceTransform(terrain)
  const { regionByTile, regions } = findTerrainRegions(terrain, distances)
  const regionSelection = createBaseRegionSelection(controller, regionByTile, regions)
  const existingSpawn = options.existingSpawn

  if (existingSpawn) {
    const spawnRegionId = regionByTile[toRoomIndex(existingSpawn.x, existingSpawn.y)]

    if (spawnRegionId >= 0) {
      regionSelection.selectedRegionIds.add(spawnRegionId)
    }
  }

  const finalVisual = new RoomVisual(roomName)
  const visualizeIntermediate = options.visualizeIntermediate ?? false
  const planningVisual = visualizeIntermediate ? finalVisual : createNoopVisual(roomName)

  let attempt = 0

  while (true) {
    if (attempt > 0 && visualizeIntermediate) {
      clearVisual(finalVisual)
    }

    const basePlan = tryPlanBaseWithRegions(
      roomName,
      terrain,
      controller,
      sources,
      minerals,
      regionSelection.selectedRegionIds,
      regionByTile,
      regions,
      planningVisual,
      finalVisual,
      visualizeIntermediate,
      existingSpawn,
    )

    if (basePlan !== undefined) {
      return basePlan
    }

    if (!regionSelection.addNextRegion()) {
      return
    }

    attempt++
  }
}

function tryPlanBaseWithRegions(
  roomName: string,
  terrain: RoomTerrain,
  controller: StructureController,
  sources: Source[],
  minerals: Mineral[],
  selectedRegionIds: ReadonlySet<number>,
  regionByTile: Int16Array,
  regions: readonly TerrainRegion[],
  visual: RoomVisual,
  finalVisual: RoomVisual,
  visualizeIntermediate: boolean,
  existingSpawn?: RoomCoordinate,
): BasePlan | undefined {
  visualizeSelectedRegions(selectedRegionIds, regions, visual)

  const outerRampartPlan = planOuterRamparts(
    terrain,
    controller,
    selectedRegionIds,
    regionByTile,
    visual,
    existingSpawn,
  )

  if (!outerRampartPlan) {
    return
  }

  const defensiveTiles = classifyDefensiveTiles(outerRampartPlan)

  // Downstream planning uses the actual min-cut interior and deliberately
  // excludes dangerous and repair standing tiles for now.
  const safePlanningMask = buildSafePlanningMask(
    outerRampartPlan.insideMask,
    defensiveTiles.dangerousMask,
    defensiveTiles.repairMask,
    existingSpawn,
  )

  const planningCenter = getMaskCenter(outerRampartPlan.insideMask)

  const controllerAreaCandidates = findControllerAreaCandidates(controller, safePlanningMask)

  let bestTier = Infinity
  let bestDistance = Infinity
  let bestCorePlan: CorePlan | undefined
  let bestControllerArea: ControllerAreaCandidate | undefined

  for (const controllerAreaCandidate of controllerAreaCandidates) {
    if (controllerAreaCandidate.tier > bestTier) {
      continue
    }

    const corePlans = findCorePlans(controllerAreaCandidate, safePlanningMask)

    for (const corePlan of corePlans) {
      const candidateDistance = getRange(corePlan.firstSpawn, planningCenter)
      if (controllerAreaCandidate.tier < bestTier || candidateDistance < bestDistance) {
        bestTier = controllerAreaCandidate.tier
        bestDistance = candidateDistance
        bestCorePlan = corePlan
        bestControllerArea = controllerAreaCandidate
      }
    }
  }

  if (!bestCorePlan || !bestControllerArea) {
    return
  }

  const resourceTree = planResourceTree(
    terrain,
    sources,
    minerals,
    bestControllerArea,
    bestCorePlan,
    visual,
    existingSpawn,
  )

  if (resourceTree === undefined) {
    return
  }

  const rampartRoadPlan = planOuterRampartRoads(
    terrain,
    controller,
    sources,
    minerals,
    outerRampartPlan,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    visual,
    existingSpawn,
  )

  if (!rampartRoadPlan) {
    return
  }

  const labPlan = planLabs(
    terrain,
    controller,
    sources,
    minerals,
    safePlanningMask,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    rampartRoadPlan,
    visual,
  )

  if (!labPlan) {
    return
  }

  const slotPlan = planStructureSlots(
    terrain,
    safePlanningMask,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    rampartRoadPlan,
    labPlan,
    visual,
    existingSpawn,
  )

  if (!slotPlan || !slotPlan.complete) {
    return
  }

  const provisionalStructures = buildProvisionalBasePlanStructures(
    sources,
    minerals,
    bestControllerArea,
    bestCorePlan,
    resourceTree,
    outerRampartPlan,
    rampartRoadPlan,
    labPlan,
    slotPlan,
    existingSpawn,
  )

  // structure(ROAD) stores road coordinates on RoomVisual separately from the
  // actual draw commands. Drop any intermediate cache before the final pass so
  // connectRoads() can only connect roads in the final plan.
  finalVisual.roads = []

  const defenseStructures = finalizeDefensePlan(
    terrain,
    controller,
    sources,
    minerals,
    provisionalStructures,
    bestCorePlan,
    finalVisual,
  )

  if (!defenseStructures) {
    return
  }

  const towers = planTowers(
    terrain,
    controller,
    sources,
    minerals,
    bestControllerArea,
    bestCorePlan,
    slotPlan,
    defenseStructures,
    existingSpawn,
  )

  if (!towers) {
    return
  }

  const structures = finalizeBasePlanStructures(
    defenseStructures,
    bestControllerArea,
    bestCorePlan,
    slotPlan,
    towers,
    finalVisual,
    existingSpawn,
  )

  if (!structures) {
    return
  }

  if (visualizeIntermediate) {
    Game.map.visual.text("SUCCESS", new RoomPosition(25, 25, roomName))
  }

  finalVisual.connectRoads()

  return {
    version: 1,
    roomName,
    anchor: bestControllerArea.storage,
    structures,
    core: {
      manager: bestCorePlan.manager,
      parking: bestCorePlan.parking,
    },
    controller: {
      upgradeChains: bestControllerArea.upgradeChains,
    },
    labs: {
      inputs: labPlan.inputLabs,
      outputs: labPlan.outputLabs,
    },
  }
}

function buildSafePlanningMask(
  insideMask: Uint8Array,
  dangerousMask: Uint8Array,
  repairMask: Uint8Array,
  existingSpawn?: RoomCoordinate,
): Uint8Array {
  const result = insideMask.slice()

  for (let index = 0; index < ROOM_AREA; index++) {
    if (dangerousMask[index] || repairMask[index]) {
      result[index] = 0
    }
  }

  if (existingSpawn) {
    result[toRoomIndex(existingSpawn.x, existingSpawn.y)] = 0
  }

  return result
}

function visualizeSelectedRegions(
  selectedRegionIds: ReadonlySet<number>,
  regions: readonly TerrainRegion[],
  visual: RoomVisual,
) {
  for (const region of regions) {
    if (selectedRegionIds.has(region.id)) {
      region.tileIndices.forEach((index) => {
        const { x, y } = fromRoomIndex(index)

        const color = getRegionColor(region.id, regions.length)
        visual.rect(x - 0.5, y - 0.5, 1, 1, {
          fill: color,
          opacity: 0.3,
          stroke: "transparent",
        })
      })
    }
  }
}

function getMaskCenter(mask: Uint8Array): RoomCoordinate {
  let sumX = 0
  let sumY = 0
  let numTiles = 0

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!mask[index]) {
      continue
    }

    const { x, y } = fromRoomIndex(index)
    sumX += x
    sumY += y
    numTiles++
  }

  return {
    x: Math.round(sumX / numTiles),
    y: Math.round(sumY / numTiles),
  }
}

function clearVisual(visual: RoomVisual): void {
  visual.clear()
  visual.roads = []
}

function createNoopVisual(roomName: string): RoomVisual {
  const noop = (): RoomVisual => visual

  const visual = {
    roomName,
    structure: noop,
    text: noop,
    rect: noop,
    arrow: noop,
    line: noop,
    circle: noop,
    poly: noop,
    clear: noop,
    connectRoads: noop,
  } as unknown as RoomVisual

  return visual
}

function getRegionColor(regionId: number, regionCount: number): string {
  const hue = (regionId * 360) / regionCount
  return `hsl(${hue}, 70%, 50%)`
}
