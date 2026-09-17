// ---- generic structure slots (current v2) ----
function planStructureSlots(terrain, planningMask, ca, core, resourceTree, boundary, lab) {
  const mandatory = new Uint8Array(ROOM_AREA)
  for (const c of [...core.roads, ...resourceTree.roads, ...boundary.roads, ...lab.serviceRoads])
    mandatory[idx(c.x, c.y)] = 1
  const blocked = new Uint8Array(ROOM_AREA),
    block = (c) => (blocked[idx(c.x, c.y)] = 1)
  block(ca.storage)
  const late = new Set([idx(core.factory.x, core.factory.y), idx(core.powerSpawn.x, core.powerSpawn.y)])
  for (const ch of Object.values(ca.upgradeChains)) {
    if (!ch.some((c) => late.has(idx(c.x, c.y)))) block(ch[0])
  }
  ;[core.manager, core.firstSpawn, core.link, core.terminal, core.factory, core.powerSpawn, ...core.parking].forEach(
    block,
  )
  for (const b of resourceTree.branches) {
    block(b.container)
    if (b.link) block(b.link)
  }
  ;[...lab.inputLabs, ...lab.outputLabs].forEach(block)
  const roads = mandatory.slice(),
    added = new Uint8Array(ROOM_AREA)
  let dm = maskDistance(terrain, roads, core.roads),
    slots = []
  const collect = (maxD, roadMask = roads, dmap = dm) => {
    const sd = new Int16Array(ROOM_AREA)
    sd.fill(-1)
    for (let ri = 0; ri < ROOM_AREA; ri++) {
      if (!roadMask[ri]) continue
      const rd = dmap[ri]
      if (rd < 0 || rd > maxD) continue
      const r = coord(ri)
      for (const o of NEIGHBOR_OFFSETS) {
        const x = r.x + o.x,
          y = r.y + o.y
        if (!inside(x, y)) continue
        const i = idx(x, y)
        if (terrain.get(x, y) === 1 || roadMask[i] || mandatory[i] || blocked[i] || !planningMask[i]) continue
        const v = rd + 1
        if (sd[i] < 0 || v < sd[i]) sd[i] = v
      }
    }
    const a = []
    for (let i = 0; i < ROOM_AREA; i++) if (sd[i] >= 0) a.push({ coordinate: coord(i), serviceDistance: sd[i] })
    return a
  }
  const gen = (maxD) => {
    const a = [],
      seen = new Set()
    for (let root = 0; root < ROOM_AREA; root++) {
      if (!roads[root]) continue
      const rd = dm[root]
      if (rd < 0 || rd > maxD) continue
      const r = coord(root)
      for (const dir of NEIGHBOR_OFFSETS) {
        const ids = [],
          ds = []
        let cur = rd
        for (let st = 1; st <= 3; st++) {
          const x = r.x + dir.x * st,
            y = r.y + dir.y * st
          if (!inside(x, y) || terrain.get(x, y) === 1) break
          const i = idx(x, y)
          if (!planningMask[i] || blocked[i]) break
          let nd = cur + 1
          if (roads[i] && dm[i] >= 0) nd = Math.min(nd, dm[i])
          if (nd > maxD) break
          cur = nd
          if (!roads[i]) {
            ids.push(i)
            ds.push(cur)
          }
        }
        if (ids.length < 2) continue
        const key = ids
          .map((v, i) => `${v}:${ds[i]}`)
          .sort()
          .join(",")
        if (!seen.has(key)) {
          seen.add(key)
          a.push({ newRoadIndices: ids, newRoadDistances: ds })
        }
      }
    }
    return a
  }
  for (let lim = 3; lim <= 52; lim += 3) {
    const maxD = Math.min(lim, 50)
    slots = collect(maxD)
    while (slots.length < 70) {
      let best = null,
        bg = 0,
        bc = Infinity
      for (const c of gen(maxD)) {
        const rm = roads.slice(),
          cd = dm.slice()
        for (let i = 0; i < c.newRoadIndices.length; i++) {
          rm[c.newRoadIndices[i]] = 1
          cd[c.newRoadIndices[i]] = c.newRoadDistances[i]
        }
        const ss = collect(maxD, rm, cd),
          gain = ss.length - slots.length,
          cost = c.newRoadIndices.length
        if (gain <= 0) continue
        if (best && (gain * bc < bg * cost || (gain * bc === bg * cost && (gain < bg || (gain === bg && cost >= bc)))))
          continue
        best = c
        bg = gain
        bc = cost
      }
      if (!best) break
      for (const i of best.newRoadIndices) {
        roads[i] = 1
        added[i] = 1
      }
      dm = maskDistance(terrain, roads, core.roads)
      slots = collect(maxD)
    }
    if (slots.length >= 70) break
  }
  const addRoads = []
  for (let i = 0; i < ROOM_AREA; i++) if (added[i]) addRoads.push(coord(i))
  return { slots, roads: addRoads, complete: slots.length >= 65 }
}
