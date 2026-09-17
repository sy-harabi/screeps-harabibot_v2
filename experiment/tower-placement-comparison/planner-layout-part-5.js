// ---- final slot assignment ----
function finalizeBasePlanStructures(defense, ca, core, slotPlan, towers) {
  const slotMask = new Uint8Array(ROOM_AREA),
    towerMask = new Uint8Array(ROOM_AREA)
  slotPlan.slots.forEach((s) => (slotMask[idx(s.coordinate.x, s.coordinate.y)] = 1))
  towers.forEach((c) => (towerMask[idx(c.x, c.y)] = 1))
  const structures = defense.filter(
      (s) => !(s.structureType === "extension" && slotMask[idx(s.coordinate.x, s.coordinate.y)]),
    ),
    road = new Uint8Array(ROOM_AREA)
  for (const s of structures) if (s.structureType === "road") road[idx(s.coordinate.x, s.coordinate.y)] = 1
  const lateMask = new Uint8Array(ROOM_AREA),
    late = new Set([idx(core.factory.x, core.factory.y), idx(core.powerSpawn.x, core.powerSpawn.y)])
  for (const ch of Object.values(ca.upgradeChains))
    if (ch.some((c) => late.has(idx(c.x, c.y)))) ch.forEach((c) => (lateMask[idx(c.x, c.y)] = 1))
  const slots = slotPlan.slots
    .map((slot) => ({
      slot,
      lateChain: !!lateMask[idx(slot.coordinate.x, slot.coordinate.y)],
      roomIndex: idx(slot.coordinate.x, slot.coordinate.y),
    }))
    .filter((s) => !towerMask[s.roomIndex])
    .sort((a, b) =>
      a.lateChain !== b.lateChain
        ? a.lateChain
          ? 1
          : -1
        : a.slot.serviceDistance - b.slot.serviceDistance || a.roomIndex - b.roomIndex,
    )
  if (slots.length < 64) return
  const sp = []
  for (let k = 0; k < 2; k++) {
    const i = slots.findIndex((s) => countAdjacentRoads(s.slot.coordinate, road) >= 2)
    if (i < 0) return
    sp.push(slots.splice(i, 1)[0])
  }
  const observer = slots.pop(),
    nuker = slots.pop()
  if (!observer || !nuker) return
  const ext = slots.slice(0, 60)
  if (ext.length !== 60) return
  const seen = new Set(structures.map((s) => `${s.structureType}:${s.coordinate.x}:${s.coordinate.y}`)),
    add = (t, c, r) => {
      const k = `${t}:${c.x}:${c.y}`
      if (!seen.has(k)) {
        seen.add(k)
        structures.push(S(t, c, r))
      }
    }
  towers.forEach((c, i) => add("tower", c, rclFor("tower", i)))
  sp.forEach((s, i) => add("spawn", s.slot.coordinate, rclFor("spawn", i + 1)))
  add("observer", observer.slot.coordinate, rclFor("observer"))
  add("nuker", nuker.slot.coordinate, rclFor("nuker"))
  ext.forEach((s, i) => add("extension", s.slot.coordinate, rclFor("extension", i)))
  return structures
}
