// ---- planner orchestration + diagnostics ----
function safeMaskOf(outer) {
  const def = classifyDefensiveTiles(outer),
    m = outer.insideMask.slice()
  for (let i = 0; i < ROOM_AREA; i++) if (def.dangerousMask[i] || def.repairMask[i]) m[i] = 0
  return m
}
function maskCenter(m) {
  let sx = 0,
    sy = 0,
    n = 0
  for (let i = 0; i < ROOM_AREA; i++)
    if (m[i]) {
      const c = coord(i)
      sx += c.x
      sy += c.y
      n++
    }
  return { x: Math.round(sx / n), y: Math.round(sy / n) }
}
function planBaseOffline(room) {
  const terrain = new Terrain(room.terrain),
    controller = room.controller ? { id: "controller", pos: { ...room.controller } } : null,
    sources = (room.sources || []).map((p, i) => ({ id: p.id || `source${i}`, pos: { x: p.x, y: p.y } })),
    minerals = (room.minerals || []).map((p, i) => ({
      id: p.id || `mineral${i}`,
      pos: { x: p.x, y: p.y },
      mineralType: p.mineralType || p.type || "H",
    }))
  if (!controller) return { ok: false, failureStage: "controller", message: "No controller in room" }
  const distances = distanceTransform(terrain),
    tr = findTerrainRegions(terrain, distances),
    selection = createBaseRegionSelection(controller, tr.regionByTile, tr.regions)
  let attempt = 0,
    last = { failureStage: "unknown" }
  while (true) {
    const selected = new Set(selection.selectedRegionIds),
      diag = { attempt, selectedRegions: [...selected] }
    const outer = planOuterRamparts(terrain, controller, selected, tr.regionByTile)
    if (!outer) {
      last = { ...diag, failureStage: "outerRamparts" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    diag.outerRamparts = outer.ramparts.length
    const safe = safeMaskOf(outer),
      center = maskCenter(outer.insideMask),
      cas = findControllerAreaCandidates(controller, safe)
    diag.controllerCandidates = cas.length
    let bestTier = Infinity,
      bestDistance = Infinity,
      core,
      bca
    for (const ca of cas) {
      if (ca.tier > bestTier) continue
      for (const cp of findCorePlans(ca, safe)) {
        const dd = range(cp.firstSpawn, center)
        if (ca.tier < bestTier || dd < bestDistance) {
          bestTier = ca.tier
          bestDistance = dd
          core = cp
          bca = ca
        }
      }
    }
    if (!core) {
      last = { ...diag, failureStage: "corePlan" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    diag.tier = bca.tier
    diag.storage = bca.storage
    const resource = planResourceTree(terrain, sources, minerals, bca, core)
    if (!resource) {
      last = { ...diag, failureStage: "resourceTree" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const boundary = planOuterRampartRoads(terrain, controller, sources, minerals, outer, bca, core, resource)
    if (!boundary) {
      last = { ...diag, failureStage: "outerRampartRoads" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const lab = planLabs(terrain, controller, sources, minerals, safe, bca, core, resource, boundary)
    if (!lab) {
      last = { ...diag, failureStage: "labs" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const slots = planStructureSlots(terrain, safe, bca, core, resource, boundary, lab)
    diag.slots = slots?.slots.length || 0
    if (!slots || !slots.complete) {
      last = { ...diag, failureStage: "structureSlots" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const provisional = buildProvisionalBasePlanStructures(
        sources,
        minerals,
        bca,
        core,
        resource,
        outer,
        boundary,
        lab,
        slots,
      ),
      defense = finalizeDefensePlan(terrain, controller, sources, minerals, provisional, core)
    if (!defense) {
      last = { ...diag, failureStage: "finalizeDefense" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const towerContext = buildTowerPlanningContext(terrain, controller, sources, minerals, bca, core, slots, defense),
      towerCandidates = towerContext && selectCurrentV2TowerCandidates(towerContext),
      towers = towerCandidates?.map((c) => c.coordinate)
    if (!towerContext || !towers || towers.length !== 6) {
      last = { ...diag, failureStage: "towers" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    const structures = finalizeBasePlanStructures(defense, bca, core, slots, towers)
    if (!structures) {
      last = { ...diag, failureStage: "finalizeStructures" }
      if (!selection.addNextRegion()) break
      attempt++
      continue
    }
    return {
      ok: true,
      plan: { version: 1, roomName: room.roomName, storage: { ...bca.storage }, structures },
      towerContext: { ...towerContext, plannerTowers: towers },
      diagnostics: { ...diag, success: true, structures: structures.length, towers: towers.length },
    }
  }
  return { ok: false, ...last, message: `Planner exhausted region expansion at ${last.failureStage}` }
}

if (typeof module !== "undefined") module.exports = { planBaseOffline, Terrain }
