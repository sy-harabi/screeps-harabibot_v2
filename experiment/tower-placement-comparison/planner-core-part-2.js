// terrain regions
const OUTSIDE_REGION_ID = 0
function findTerrainRegions(terrain, distances, minPeakDistance = 4) {
  const edge = []
  for (let x = 0; x < 50; x++) {
    edge.push({ x, y: 0 }, { x, y: 49 })
  }
  for (let y = 1; y < 49; y++) edge.push({ x: 0, y }, { x: 49, y })
  const edgeD = floodFill(terrain, edge).distances,
    by = new Int16Array(2500)
  by.fill(-1)
  const regions = []
  const seeds = []
  function add(i) {
    if (distances[i] === 0 || by[i] === 0) return
    by[i] = 0
    seeds.push(i)
  }
  function area(x, y) {
    const i = idx(x, y)
    if (distances[i] === 0) return
    add(i)
    for (const o of NEIGHBOR_OFFSETS) {
      const xx = x + o.x,
        yy = y + o.y
      if (inside(xx, yy)) add(idx(xx, yy))
    }
  }
  for (let x = 0; x < 50; x++) {
    area(x, 0)
    area(x, 49)
  }
  for (let y = 1; y < 49; y++) {
    area(0, y)
    area(49, y)
  }
  regions.push({ id: 0, tileIndices: seeds.slice(), peakIndices: seeds.slice(), peakDistance: 0 })
  const visited = new Uint8Array(2500)
  const edgeDepth = (i) => (edgeD[i] === -1 ? 2500 : edgeD[i])
  const cmp = (a, b) => distances[a] - distances[b] || edgeDepth(a) - edgeDepth(b)
  for (let i = 0; i < 2500; i++) {
    if (visited[i] || distances[i] === 0 || by[i] !== -1) continue
    const plateau = [i]
    visited[i] = 1
    let peak = distances[i] >= minPeakDistance
    for (let h = 0; h < plateau.length; h++) {
      const ci = plateau[h],
        c = coord(ci)
      for (const o of NEIGHBOR_OFFSETS) {
        const x = c.x + o.x,
          y = c.y + o.y
        if (!inside(x, y)) continue
        const ni = idx(x, y)
        if (distances[ni] === 0) continue
        const cp = cmp(ni, i)
        if (cp > 0) peak = false
        if (cp !== 0 || visited[ni] || by[ni] !== -1) continue
        visited[ni] = 1
        plateau.push(ni)
      }
    }
    if (!peak) continue
    const id = regions.length
    for (const p of plateau) by[p] = id
    regions.push({ id, tileIndices: plateau.slice(), peakIndices: plateau.slice(), peakDistance: distances[i] })
  }
  const pq = new PriorityQueue()
  const pri = (i) => distances[i] * 2501 + edgeDepth(i)
  function enq(i, rid) {
    const c = coord(i)
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (!inside(x, y)) continue
      const ni = idx(x, y)
      if (distances[ni] === 0 || by[ni] !== -1) continue
      pq.push({ index: ni, regionId: rid }, pri(ni))
    }
  }
  for (const r of regions) for (const p of r.peakIndices) enq(p, r.id)
  while (pq.size) {
    const q = pq.pop(),
      i = q.index
    if (by[i] !== -1 || distances[i] === 0) continue
    by[i] = q.regionId
    regions[q.regionId].tileIndices.push(i)
    enq(i, q.regionId)
  }
  return { regionByTile: by, regions }
}
function createBaseRegionSelection(controller, by, regions) {
  const selected = new Set()
  forInRange(controller.pos, 1, (x, y) => {
    const r = by[idx(x, y)]
    if (r > 0) selected.add(r)
  })
  const counts = new Map(regions.map((r) => [r.id, r.tileIndices.length]))
  const con = new Map()
  for (const r of regions) {
    const m = new Map()
    for (const i of r.tileIndices) {
      forInRange(coord(i), 1, (x, y) => {
        const n = by[idx(x, y)]
        if (n < 0 || n === r.id) return
        m.set(n, (m.get(n) || 0) + 1)
      })
    }
    con.set(r.id, m)
  }
  let n = [...selected].reduce((s, r) => s + (counts.get(r) || 0), 0)
  function addNext() {
    const ids = new Set()
    for (const r of selected) {
      for (const a of (con.get(r) || new Map()).keys()) if (a !== 0 && !selected.has(a)) ids.add(a)
    }
    let best
    for (const id of ids) {
      let delta = 0
      for (const [o, c] of con.get(id) || new Map()) delta += selected.has(o) ? -c : c
      const cand = { regionId: id, numTiles: counts.get(id) || 0, frontierDelta: delta }
      const better = (a, b) => {
        const an = a.frontierDelta <= 0,
          bn = b.frontierDelta <= 0
        if (an !== bn) return an
        if (an) {
          if (a.numTiles !== b.numTiles) return a.numTiles > b.numTiles
          if (a.frontierDelta !== b.frontierDelta) return a.frontierDelta < b.frontierDelta
          return a.regionId < b.regionId
        }
        const av = a.numTiles * b.frontierDelta,
          bv = b.numTiles * a.frontierDelta
        if (av !== bv) return av > bv
        if (a.numTiles !== b.numTiles) return a.numTiles > b.numTiles
        if (a.frontierDelta !== b.frontierDelta) return a.frontierDelta < b.frontierDelta
        return a.regionId < b.regionId
      }
      if (!best || better(cand, best)) best = cand
    }
    if (!best) return false
    selected.add(best.regionId)
    n += best.numTiles
    return true
  }
  while (n < 150 && addNext()) {}
  return { selectedRegionIds: selected, addNextRegion: addNext }
}
function controllerDistanceCosts(terrain, c) {
  const st = []
  forAtRange(c, 1, (x, y) => st.push({ x, y }))
  const d = floodFill(terrain, st).distances,
    a = new Uint16Array(2500)
  for (let i = 0; i < 2500; i++) a[i] = 1 + (d[i] > 15 ? d[i] - 15 : 0)
  return a
}
function exitSinkMask(terrain) {
  const m = new Uint8Array(2500)
  for (let i = 0; i < 2500; i++) {
    const c = coord(i)
    if (c.x !== 0 && c.x !== 49 && c.y !== 0 && c.y !== 49) continue
    if (terrain.get(c.x, c.y) === 1) continue
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx,
          y = c.y + dy
        if (inside(x, y) && terrain.get(x, y) !== 1) m[idx(x, y)] = 1
      }
  }
  return m
}
function planOuterRamparts(terrain, controller, selected, by) {
  const sm = new Uint8Array(2500)
  for (let i = 0; i < 2500; i++) {
    const c = coord(i)
    if (selected.has(by[i]) && terrain.get(c.x, c.y) !== 1) sm[i] = 1
  }
  const src = new Uint8Array(2500)
  for (let i = 0; i < 2500; i++) {
    if (!sm[i]) continue
    const c = coord(i)
    let ok = true
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (!inside(x, y)) {
        ok = false
        break
      }
      if (terrain.get(x, y) === 1) continue
      if (!sm[idx(x, y)]) {
        ok = false
        break
      }
    }
    if (ok) src[i] = 1
  }
  const r = minCut(terrain, src, exitSinkMask(terrain), controllerDistanceCosts(terrain, controller.pos))
  if (!r || !r.cuts.length) return
  return {
    ramparts: r.cuts,
    rampartMask: r.cutMask,
    insideMask: r.insideMask,
    outsideMask: r.outsideMask,
    totalCost: r.totalCost,
  }
}
function classifyDefensiveTiles(p) {
  const d = new Uint8Array(2500),
    rr = new Uint8Array(2500)
  for (let i = 0; i < 2500; i++)
    if (p.outsideMask[i])
      forInRange(coord(i), 3, (x, y) => {
        const j = idx(x, y)
        if (p.insideMask[j]) d[j] = 1
      })
  for (const r of p.ramparts)
    forInRange(r, 3, (x, y) => {
      const j = idx(x, y)
      if (p.insideMask[j]) rr[j] = 1
    })
  const repair = new Uint8Array(2500),
    safe = new Uint8Array(2500),
    need = new Uint8Array(2500)
  for (let i = 0; i < 2500; i++)
    if (rr[i]) {
      repair[i] = 1
      if (d[i]) need[i] = 1
      else safe[i] = 1
    }
  return {
    outerRampartMask: p.rampartMask,
    dangerousMask: d,
    repairMask: repair,
    safeRepairCandidateMask: safe,
    rampartRequiredRepairCandidateMask: need,
  }
}
