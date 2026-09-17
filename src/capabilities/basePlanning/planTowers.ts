import { floodFill } from "../../world/map/floodFill"
import { getRange, RoomCoordinate } from "../../world/map/roomCoordinate"
import {
  fromRoomIndex,
  isInsideRoom,
  NEIGHBOR_OFFSETS,
  ROOM_AREA,
  ROOM_SIZE,
  toRoomIndex,
} from "../../world/map/roomGrid"
import type { PlannedStructure } from "./basePlan"
import { classifyDefensiveTiles } from "./classifyDefensiveTiles"
import type { ControllerAreaCandidate } from "./findControllerAreaCandidates"
import type { CorePlan } from "./findCorePlans"
import type { OuterRampartPlan } from "./planOuterRamparts"
import { getSpawnPlanningInfo } from "./spawnPlanning"
import type { StructureSlotPlan } from "./planStructureSlots"

const NUM_TOWERS = 6
const NUM_EXTENSIONS = 60
const NUM_OTHER_SLOT_STRUCTURES = 2
const FULL_PAIR_SWEEPS = 2

interface TowerCandidate {
  readonly coordinate: RoomCoordinate
  readonly roomIndex: number
  readonly usesStructureSlot: boolean
  readonly usesSpawnSlot: boolean
}

interface TowerPlacementScore {
  readonly minDamage: number
  readonly weakCount: number
  readonly totalDamage: number
}

interface CandidateUsage {
  readonly slotTowers: number
  readonly spawnSlotTowers: number
}

interface DamageCache {
  readonly rampartCount: number
  readonly matrix: Uint16Array
  readonly totalDamage: Uint32Array
}

export function planTowers(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  slotPlan: StructureSlotPlan,
  structures: readonly PlannedStructure[],
  existingSpawn?: RoomCoordinate,
): RoomCoordinate[] | undefined {
  const spawnPlanning = getSpawnPlanningInfo(existingSpawn, corePlan.firstSpawn)
  const requiredNonTowerSlots = spawnPlanning.requiredSlotSpawns + NUM_EXTENSIONS + NUM_OTHER_SLOT_STRUCTURES

  if (slotPlan.slots.length < requiredNonTowerSlots) {
    return
  }

  const topology = rebuildFinalRampartPlan(terrain, structures)

  if (!topology || topology.ramparts.length === 0) {
    return
  }

  const dangerousMask = classifyDefensiveTiles(topology).dangerousMask
  const roadMask = buildRoadMask(structures)
  const spawnSlotCount = countSpawnSlots(slotPlan, roadMask)

  if (spawnSlotCount < spawnPlanning.requiredSlotSpawns) {
    return
  }

  const candidates = collectTowerCandidates(
    terrain,
    controller,
    sources,
    minerals,
    controllerArea,
    corePlan,
    slotPlan,
    structures,
    topology,
    dangerousMask,
    roadMask,
  )
  const maxSlotTowers = Math.max(0, slotPlan.slots.length - requiredNonTowerSlots)
  const selected = selectTowerCandidates(
    candidates,
    topology.ramparts,
    maxSlotTowers,
    spawnSlotCount - spawnPlanning.requiredSlotSpawns,
  )

  if (!selected || selected.length !== NUM_TOWERS) {
    return
  }

  return selected.map((index) => candidates[index].coordinate)
}

function collectTowerCandidates(
  terrain: RoomTerrain,
  controller: StructureController,
  sources: readonly Source[],
  minerals: readonly Mineral[],
  controllerArea: ControllerAreaCandidate,
  corePlan: CorePlan,
  slotPlan: StructureSlotPlan,
  structures: readonly PlannedStructure[],
  topology: OuterRampartPlan,
  dangerousMask: Uint8Array,
  roadMask: Uint8Array,
): TowerCandidate[] {
  const slotMask = new Uint8Array(ROOM_AREA)

  for (const { coordinate } of slotPlan.slots) {
    slotMask[toRoomIndex(coordinate.x, coordinate.y)] = 1
  }

  const rampartMask = new Uint8Array(ROOM_AREA)
  const occupiedMask = new Uint8Array(ROOM_AREA)

  for (const structure of structures) {
    const { x, y } = structure.coordinate
    const index = toRoomIndex(x, y)

    if (structure.structureType === STRUCTURE_ROAD) {
      continue
    }

    if (structure.structureType === STRUCTURE_RAMPART) {
      rampartMask[index] = 1
      continue
    }

    // Slot extensions are temporary defense-finalization placeholders. Towers
    // intentionally get priority over them before the real slot assignment.
    if (structure.structureType === STRUCTURE_EXTENSION && slotMask[index]) {
      continue
    }

    occupiedMask[index] = 1
  }

  const reservedOpenMask = buildReservedOpenTileMask(controllerArea, corePlan)
  const roomObjectMask = new Uint8Array(ROOM_AREA)
  roomObjectMask[toRoomIndex(controller.pos.x, controller.pos.y)] = 1

  for (const { pos } of sources) {
    roomObjectMask[toRoomIndex(pos.x, pos.y)] = 1
  }

  for (const { pos } of minerals) {
    roomObjectMask[toRoomIndex(pos.x, pos.y)] = 1
  }

  const seen = new Uint8Array(ROOM_AREA)
  const candidates: TowerCandidate[] = []

  for (let roadIndex = 0; roadIndex < ROOM_AREA; roadIndex++) {
    if (!roadMask[roadIndex] || !topology.insideMask[roadIndex]) {
      continue
    }

    const road = fromRoomIndex(roadIndex)

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = road.x + offset.x
      const y = road.y + offset.y

      if (!isInsideRoom(x, y)) {
        continue
      }

      const index = toRoomIndex(x, y)

      if (seen[index]) {
        continue
      }
      seen[index] = 1

      if (!topology.insideMask[index]) {
        continue
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue
      }

      if (roadMask[index] || occupiedMask[index] || reservedOpenMask[index] || roomObjectMask[index]) {
        continue
      }

      // Defense is already finalized. A dangerous tile is only valid if the
      // defense pass already placed an overlapping rampart there for a slot.
      if (dangerousMask[index] && !rampartMask[index]) {
        continue
      }

      const usesStructureSlot = slotMask[index] === 1

      candidates.push({
        coordinate: { x, y },
        roomIndex: index,
        usesStructureSlot,
        usesSpawnSlot: usesStructureSlot && countAdjacentRoads({ x, y }, roadMask) >= 2,
      })
    }
  }

  return candidates
}

function selectTowerCandidates(
  candidates: readonly TowerCandidate[],
  ramparts: readonly RoomCoordinate[],
  maxSlotTowers: number,
  maxSpawnSlotTowers: number,
): number[] | undefined {
  if (candidates.length < NUM_TOWERS || ramparts.length === 0) {
    return
  }

  const cache = buildDamageCache(candidates, ramparts)
  const greedy = buildGlobalGreedyPlacement(candidates, cache, maxSlotTowers, maxSpawnSlotTowers)

  if (!greedy) {
    return
  }

  return refineTowerPairs(greedy, candidates, cache, maxSlotTowers, maxSpawnSlotTowers, FULL_PAIR_SWEEPS)
}

function buildDamageCache(candidates: readonly TowerCandidate[], ramparts: readonly RoomCoordinate[]): DamageCache {
  const rampartCount = ramparts.length
  const matrix = new Uint16Array(candidates.length * rampartCount)
  const totalDamage = new Uint32Array(candidates.length)

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex]
    const offset = candidateIndex * rampartCount
    let total = 0

    for (let rampartIndex = 0; rampartIndex < rampartCount; rampartIndex++) {
      const damage = Math.round(getTowerDamage(getRange(candidate.coordinate, ramparts[rampartIndex])))
      matrix[offset + rampartIndex] = damage
      total += damage
    }

    totalDamage[candidateIndex] = total
  }

  return { rampartCount, matrix, totalDamage }
}

function buildGlobalGreedyPlacement(
  candidates: readonly TowerCandidate[],
  cache: DamageCache,
  maxSlotTowers: number,
  maxSpawnSlotTowers: number,
): number[] | undefined {
  const selected: number[] = []
  const used = new Uint8Array(candidates.length)
  const damage = new Uint16Array(cache.rampartCount)
  let totalDamage = 0
  let slotTowers = 0
  let spawnSlotTowers = 0

  while (selected.length < NUM_TOWERS) {
    let bestCandidate = -1
    let bestScore: TowerPlacementScore | undefined

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if (used[candidateIndex]) {
        continue
      }

      const candidate = candidates[candidateIndex]

      if (!canAddCandidate(candidate, slotTowers, spawnSlotTowers, maxSlotTowers, maxSpawnSlotTowers)) {
        continue
      }

      const score = scoreAddedCandidate(damage, totalDamage, candidateIndex, cache)

      if (
        !bestScore ||
        isPrimaryScoreBetter(score, bestScore) ||
        (isSamePrimaryScore(score, bestScore) && isCandidateTieBetter(candidate, candidates[bestCandidate]))
      ) {
        bestCandidate = candidateIndex
        bestScore = score
      }
    }

    if (bestCandidate < 0) {
      return
    }

    selected.push(bestCandidate)
    used[bestCandidate] = 1
    addCandidateDamage(damage, bestCandidate, cache)
    totalDamage += cache.totalDamage[bestCandidate]
    slotTowers += candidates[bestCandidate].usesStructureSlot ? 1 : 0
    spawnSlotTowers += candidates[bestCandidate].usesSpawnSlot ? 1 : 0
  }

  return selected
}

function refineTowerPairs(
  initial: readonly number[],
  candidates: readonly TowerCandidate[],
  cache: DamageCache,
  maxSlotTowers: number,
  maxSpawnSlotTowers: number,
  sweeps: number,
): number[] {
  const selected = [...initial]

  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let firstIndex = 0; firstIndex < NUM_TOWERS - 1; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < NUM_TOWERS; secondIndex++) {
        const fixed: number[] = []

        for (let index = 0; index < NUM_TOWERS; index++) {
          if (index !== firstIndex && index !== secondIndex) {
            fixed.push(selected[index])
          }
        }

        const fixedSet = buildSelectedMask(fixed, candidates.length)
        const fixedUsage = getSelectionUsage(fixed, candidates)
        const fixedDamage = buildSelectionDamage(fixed, cache)
        const fixedTotalDamage = getSelectionTotalDamage(fixed, cache)
        let bestFirst = selected[firstIndex]
        let bestSecond = selected[secondIndex]
        let bestScore = scoreSelection(selected, cache)
        let bestTie = getPairTie(candidates[bestFirst].roomIndex, candidates[bestSecond].roomIndex)

        for (let firstCandidate = 0; firstCandidate < candidates.length - 1; firstCandidate++) {
          if (fixedSet[firstCandidate]) {
            continue
          }

          const first = candidates[firstCandidate]
          const firstSlotTowers = fixedUsage.slotTowers + (first.usesStructureSlot ? 1 : 0)
          const firstSpawnSlotTowers = fixedUsage.spawnSlotTowers + (first.usesSpawnSlot ? 1 : 0)

          if (firstSlotTowers > maxSlotTowers || firstSpawnSlotTowers > maxSpawnSlotTowers) {
            continue
          }

          for (let secondCandidate = firstCandidate + 1; secondCandidate < candidates.length; secondCandidate++) {
            if (fixedSet[secondCandidate]) {
              continue
            }

            const second = candidates[secondCandidate]

            if (
              firstSlotTowers + (second.usesStructureSlot ? 1 : 0) > maxSlotTowers ||
              firstSpawnSlotTowers + (second.usesSpawnSlot ? 1 : 0) > maxSpawnSlotTowers
            ) {
              continue
            }

            const score = scoreAddedCandidatePair(fixedDamage, fixedTotalDamage, firstCandidate, secondCandidate, cache)
            const tie = getPairTie(first.roomIndex, second.roomIndex)

            if (isPrimaryScoreBetter(score, bestScore) || (isSamePrimaryScore(score, bestScore) && tie < bestTie)) {
              bestFirst = firstCandidate
              bestSecond = secondCandidate
              bestScore = score
              bestTie = tie
            }
          }
        }

        selected[firstIndex] = bestFirst
        selected[secondIndex] = bestSecond
      }
    }
  }

  return selected
}

function scoreAddedCandidate(
  baseDamage: Uint16Array,
  baseTotalDamage: number,
  candidateIndex: number,
  cache: DamageCache,
): TowerPlacementScore {
  const offset = candidateIndex * cache.rampartCount
  let minDamage = Infinity
  let weakCount = 0

  for (let rampartIndex = 0; rampartIndex < cache.rampartCount; rampartIndex++) {
    const damage = baseDamage[rampartIndex] + cache.matrix[offset + rampartIndex]

    if (damage < minDamage) {
      minDamage = damage
      weakCount = 1
    } else if (damage === minDamage) {
      weakCount++
    }
  }

  return {
    minDamage,
    weakCount,
    totalDamage: baseTotalDamage + cache.totalDamage[candidateIndex],
  }
}

function scoreAddedCandidatePair(
  baseDamage: Uint16Array,
  baseTotalDamage: number,
  firstCandidate: number,
  secondCandidate: number,
  cache: DamageCache,
): TowerPlacementScore {
  const firstOffset = firstCandidate * cache.rampartCount
  const secondOffset = secondCandidate * cache.rampartCount
  let minDamage = Infinity
  let weakCount = 0

  for (let rampartIndex = 0; rampartIndex < cache.rampartCount; rampartIndex++) {
    const damage =
      baseDamage[rampartIndex] + cache.matrix[firstOffset + rampartIndex] + cache.matrix[secondOffset + rampartIndex]

    if (damage < minDamage) {
      minDamage = damage
      weakCount = 1
    } else if (damage === minDamage) {
      weakCount++
    }
  }

  return {
    minDamage,
    weakCount,
    totalDamage: baseTotalDamage + cache.totalDamage[firstCandidate] + cache.totalDamage[secondCandidate],
  }
}

function scoreSelection(selected: readonly number[], cache: DamageCache): TowerPlacementScore {
  const damage = buildSelectionDamage(selected, cache)
  let minDamage = Infinity
  let weakCount = 0
  let totalDamage = 0

  for (let rampartIndex = 0; rampartIndex < cache.rampartCount; rampartIndex++) {
    const value = damage[rampartIndex]
    totalDamage += value

    if (value < minDamage) {
      minDamage = value
      weakCount = 1
    } else if (value === minDamage) {
      weakCount++
    }
  }

  return { minDamage, weakCount, totalDamage }
}

function buildSelectionDamage(selected: readonly number[], cache: DamageCache): Uint16Array {
  const damage = new Uint16Array(cache.rampartCount)

  for (const candidateIndex of selected) {
    addCandidateDamage(damage, candidateIndex, cache)
  }

  return damage
}

function addCandidateDamage(damage: Uint16Array, candidateIndex: number, cache: DamageCache): void {
  const offset = candidateIndex * cache.rampartCount

  for (let rampartIndex = 0; rampartIndex < cache.rampartCount; rampartIndex++) {
    damage[rampartIndex] += cache.matrix[offset + rampartIndex]
  }
}

function getSelectionTotalDamage(selected: readonly number[], cache: DamageCache): number {
  let total = 0

  for (const candidateIndex of selected) {
    total += cache.totalDamage[candidateIndex]
  }

  return total
}

function buildSelectedMask(selected: readonly number[], candidateCount: number): Uint8Array {
  const mask = new Uint8Array(candidateCount)

  for (const candidateIndex of selected) {
    mask[candidateIndex] = 1
  }

  return mask
}

function getSelectionUsage(selected: readonly number[], candidates: readonly TowerCandidate[]): CandidateUsage {
  let slotTowers = 0
  let spawnSlotTowers = 0

  for (const candidateIndex of selected) {
    slotTowers += candidates[candidateIndex].usesStructureSlot ? 1 : 0
    spawnSlotTowers += candidates[candidateIndex].usesSpawnSlot ? 1 : 0
  }

  return { slotTowers, spawnSlotTowers }
}

function canAddCandidate(
  candidate: TowerCandidate,
  slotTowers: number,
  spawnSlotTowers: number,
  maxSlotTowers: number,
  maxSpawnSlotTowers: number,
): boolean {
  return (
    slotTowers + (candidate.usesStructureSlot ? 1 : 0) <= maxSlotTowers &&
    spawnSlotTowers + (candidate.usesSpawnSlot ? 1 : 0) <= maxSpawnSlotTowers
  )
}

function isPrimaryScoreBetter(candidate: TowerPlacementScore, current: TowerPlacementScore): boolean {
  if (candidate.minDamage !== current.minDamage) {
    return candidate.minDamage > current.minDamage
  }

  if (candidate.weakCount !== current.weakCount) {
    return candidate.weakCount < current.weakCount
  }

  return candidate.totalDamage > current.totalDamage
}

function isSamePrimaryScore(first: TowerPlacementScore, second: TowerPlacementScore): boolean {
  return (
    first.minDamage === second.minDamage &&
    first.weakCount === second.weakCount &&
    first.totalDamage === second.totalDamage
  )
}

function isCandidateTieBetter(candidate: TowerCandidate, current: TowerCandidate | undefined): boolean {
  return !current || candidate.roomIndex < current.roomIndex
}

function getPairTie(firstRoomIndex: number, secondRoomIndex: number): number {
  const lower = Math.min(firstRoomIndex, secondRoomIndex)
  const higher = Math.max(firstRoomIndex, secondRoomIndex)
  return lower * ROOM_AREA + higher
}

function buildRoadMask(structures: readonly PlannedStructure[]): Uint8Array {
  const roadMask = new Uint8Array(ROOM_AREA)

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_ROAD) {
      continue
    }

    const { x, y } = structure.coordinate
    roadMask[toRoomIndex(x, y)] = 1
  }

  return roadMask
}

function countSpawnSlots(slotPlan: StructureSlotPlan, roadMask: Uint8Array): number {
  let count = 0

  for (const { coordinate } of slotPlan.slots) {
    if (countAdjacentRoads(coordinate, roadMask) >= 2) {
      count++
    }
  }

  return count
}

function countAdjacentRoads(coordinate: RoomCoordinate, roadMask: Uint8Array): number {
  let count = 0

  for (const offset of NEIGHBOR_OFFSETS) {
    const x = coordinate.x + offset.x
    const y = coordinate.y + offset.y

    if (!isInsideRoom(x, y)) {
      continue
    }

    if (roadMask[toRoomIndex(x, y)]) {
      count++
    }
  }

  return count
}

function buildReservedOpenTileMask(controllerArea: ControllerAreaCandidate, corePlan: CorePlan): Uint8Array {
  const mask = new Uint8Array(ROOM_AREA)
  const block = ({ x, y }: RoomCoordinate): void => {
    mask[toRoomIndex(x, y)] = 1
  }

  block(corePlan.manager)
  corePlan.parking.forEach(block)

  const lateStructureIndices = new Set([
    toRoomIndex(corePlan.factory.x, corePlan.factory.y),
    toRoomIndex(corePlan.powerSpawn.x, corePlan.powerSpawn.y),
  ])
  const { left, middle, right } = controllerArea.upgradeChains

  for (const chain of [left, middle, right]) {
    const isLateStructureChain = chain.some(({ x, y }) => lateStructureIndices.has(toRoomIndex(x, y)))

    if (!isLateStructureChain) {
      block(chain[0])
    }
  }

  return mask
}

function rebuildFinalRampartPlan(
  terrain: RoomTerrain,
  structures: readonly PlannedStructure[],
): OuterRampartPlan | undefined {
  const allRampartMask = new Uint8Array(ROOM_AREA)

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_RAMPART) {
      continue
    }

    const { x, y } = structure.coordinate
    allRampartMask[toRoomIndex(x, y)] = 1
  }

  const outsideWithAllRamparts = buildOutsideMask(terrain, allRampartMask)
  const outerRampartMask = new Uint8Array(ROOM_AREA)

  for (let index = 0; index < ROOM_AREA; index++) {
    if (!allRampartMask[index]) {
      continue
    }

    const coordinate = fromRoomIndex(index)

    for (const offset of NEIGHBOR_OFFSETS) {
      const x = coordinate.x + offset.x
      const y = coordinate.y + offset.y

      if (!isInsideRoom(x, y)) {
        continue
      }

      if (outsideWithAllRamparts[toRoomIndex(x, y)]) {
        outerRampartMask[index] = 1
        break
      }
    }
  }

  const ramparts = coordinatesFromMask(outerRampartMask)

  if (ramparts.length === 0) {
    return
  }

  const outsideMask = buildOutsideMask(terrain, outerRampartMask)
  const insideMask = new Uint8Array(ROOM_AREA)

  for (let index = 0; index < ROOM_AREA; index++) {
    const { x, y } = fromRoomIndex(index)

    if (terrain.get(x, y) === TERRAIN_MASK_WALL || outerRampartMask[index]) {
      continue
    }

    if (!outsideMask[index]) {
      insideMask[index] = 1
    }
  }

  return {
    ramparts,
    rampartMask: outerRampartMask,
    insideMask,
    outsideMask,
  }
}

function buildOutsideMask(terrain: RoomTerrain, rampartMask: Uint8Array): Uint8Array {
  const exits = getExitCoordinates(terrain).filter(({ x, y }) => !rampartMask[toRoomIndex(x, y)])
  const { distances } = floodFill(terrain, exits, (x, y) => !rampartMask[toRoomIndex(x, y)])
  const outsideMask = new Uint8Array(ROOM_AREA)

  for (let index = 0; index < ROOM_AREA; index++) {
    if (distances[index] >= 0) {
      outsideMask[index] = 1
    }
  }

  return outsideMask
}

function getExitCoordinates(terrain: RoomTerrain): RoomCoordinate[] {
  const exits: RoomCoordinate[] = []

  for (let x = 0; x < ROOM_SIZE; x++) {
    for (const y of [0, ROOM_SIZE - 1]) {
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exits.push({ x, y })
      }
    }
  }

  for (let y = 1; y < ROOM_SIZE - 1; y++) {
    for (const x of [0, ROOM_SIZE - 1]) {
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        exits.push({ x, y })
      }
    }
  }

  return exits
}

function coordinatesFromMask(mask: Uint8Array): RoomCoordinate[] {
  const coordinates: RoomCoordinate[] = []

  for (let index = 0; index < ROOM_AREA; index++) {
    if (mask[index]) {
      coordinates.push(fromRoomIndex(index))
    }
  }

  return coordinates
}

function getTowerDamage(range: number): number {
  if (range <= TOWER_OPTIMAL_RANGE) {
    return TOWER_POWER_ATTACK
  }

  const clampedRange = Math.min(range, TOWER_FALLOFF_RANGE)
  const falloff = (TOWER_FALLOFF * (clampedRange - TOWER_OPTIMAL_RANGE)) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE)

  return TOWER_POWER_ATTACK * (1 - falloff)
}
