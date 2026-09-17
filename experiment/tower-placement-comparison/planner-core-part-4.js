function buildResourceDistanceMap(terrain, blocked, roads) {
  return dijkstraMap(
    terrain,
    roads,
    (x, y, t) => (t === 2 ? 6 : 5),
    (x, y) => blocked[idx(x, y)] === 0,
  )
}
function planResourceEndpoints(terrain, sources, minerals, ca, core) {
  const targets = [
    ...sources.map((s, i) => ({ targetId: s.id, coordinate: s.pos, bit: 1 << i, kind: "source" })),
    ...minerals.map((m, i) => ({ targetId: m.id, coordinate: m.pos, bit: 1 << (sources.length + i), kind: "mineral" })),
  ]
  const blocked = new Uint8Array(2500),
    block = (c) => (blocked[idx(c.x, c.y)] = 1)
  block(ca.storage)
  Object.values(ca.upgradeChains).forEach((ch) => ch.forEach(block))
  ;[core.firstSpawn, core.terminal, core.link, core.manager, ...core.parking].forEach(block)
  ;[...sources, ...minerals].forEach((r) => block(r.pos))
  const coreMask = new Uint8Array(2500)
  core.roads.forEach((c) => (coreMask[idx(c.x, c.y)] = 1))
  function sourceLinks(container) {
    const a = []
    forAtRange(container, 1, (x, y) => {
      const i = idx(x, y)
      if (terrain.get(x, y) !== 1 && !blocked[i] && !coreMask[i]) a.push({ x, y })
    })
    a.sort((a, b) => idx(a.x, a.y) - idx(b.x, b.y))
    return a
  }
  function candidates(t, dmap) {
    const a = []
    forAtRange(t.coordinate, 1, (x, y) => {
      const ci = idx(x, y),
        d = dmap[ci]
      if (d < 0 || coreMask[ci]) return
      const c = { x, y }
      if (t.kind === "mineral") a.push({ container: c, distance: d })
      else for (const l of sourceLinks(c)) a.push({ container: c, link: l, distance: d })
    })
    a.sort(
      (a, b) =>
        a.distance - b.distance ||
        idx(a.container.x, a.container.y) - idx(b.container.x, b.container.y) ||
        (a.link ? idx(a.link.x, a.link.y) : -1) - (b.link ? idx(b.link.x, b.link.y) : -1),
    )
    return a
  }
  function reachable(planned, d) {
    return planned.every((e) => {
      let ok = false
      forAtRange(e.container, 1, (x, y) => {
        if (d[idx(x, y)] >= 0) ok = true
      })
      return ok
    })
  }
  function rec(rem, planned) {
    const d = buildResourceDistanceMap(terrain, blocked, core.roads)
    if (!reachable(planned, d)) return
    if (!rem.length) return planned.slice()
    let si = -1,
      sc = [],
      sd = Infinity
    for (let i = 0; i < rem.length; i++) {
      const cs = candidates(rem[i], d)
      if (!cs.length) return
      if (cs[0].distance < sd) {
        si = i
        sc = cs
        sd = cs[0].distance
      }
    }
    if (si < 0) return
    const t = rem[si],
      nr = rem.filter((_, i) => i !== si)
    for (const c of sc) {
      const ep = { ...t, container: c.container, link: c.link }
      blocked[idx(c.container.x, c.container.y)] = 1
      if (c.link) blocked[idx(c.link.x, c.link.y)] = 1
      const r = rec(nr, [...planned, ep])
      if (r) return r
      blocked[idx(c.container.x, c.container.y)] = 0
      if (c.link) blocked[idx(c.link.x, c.link.y)] = 0
    }
  }
  const endpoints = rec(targets, [])
  return endpoints ? { endpoints, resourceRoadBlockedMask: blocked } : undefined
}
function shortestPathMask(targets, terrain, d) {
  const mask = new Uint8Array(2500),
    q = []
  for (const t of targets) {
    const i = idx(t.x, t.y)
    mask[i] = 1
    q.push(i)
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h],
      c = coord(i),
      cd = d[i]
    if (cd === 0) continue
    const cc = terrain.get(c.x, c.y) === 2 ? 6 : 5
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (!inside(x, y)) continue
      const ni = idx(x, y)
      if (d[ni] < 0 || mask[ni]) continue
      if (d[ni] + cc !== cd) continue
      mask[ni] = 1
      q.push(ni)
    }
  }
  return mask
}
function planResourceTree(terrain, sources, minerals, ca, core) {
  const pr = planResourceEndpoints(terrain, sources, minerals, ca, core)
  if (!pr) return
  const targets = pr.endpoints.slice().sort((a, b) => a.bit - b.bit),
    d = buildResourceDistanceMap(terrain, pr.resourceRoadBlockedMask, core.roads)
  if (!targets.length) return { roads: [], branches: [] }
  const rpm = new Uint8Array(2500),
    tm = new Uint8Array(2500)
  for (const t of targets) {
    let ends = [],
      md = Infinity
    for (const o of NEIGHBOR_OFFSETS) {
      const x = t.container.x + o.x,
        y = t.container.y + o.y
      if (!inside(x, y)) continue
      const di = d[idx(x, y)]
      if (di < 0) continue
      if (di < md) {
        md = di
        ends = [{ x, y }]
      } else if (di === md) ends.push({ x, y })
    }
    if (!ends.length) return
    for (const c of ends) tm[idx(c.x, c.y)] |= t.bit
    const pm = shortestPathMask(ends, terrain, d)
    for (let i = 0; i < 2500; i++) if (pm[i]) rpm[i] |= t.bit
  }
  const mc = 1 << targets.length,
    full = mc - 1,
    INF = 30000,
    dp = new Int16Array(2500 * mc)
  dp.fill(INF)
  const dt = new Uint8Array(dp.length),
    dv = new Int16Array(dp.length)
  dv.fill(-1)
  const pis = []
  for (let i = 0; i < 2500; i++) if (rpm[i]) pis.push(i)
  pis.sort((a, b) => d[b] - d[a] || a - b)
  for (const i of pis) {
    const c = coord(i),
      tile = d[i] === 0 ? 0 : 1
    for (let mask = 1; mask <= full; mask++) {
      if ((rpm[i] & mask) !== mask) continue
      const key = i * mc + mask
      let best = INF,
        bt = 0,
        bv = -1
      if ((tm[i] & mask) === mask) {
        best = tile
        bt = 1
      }
      for (const o of NEIGHBOR_OFFSETS) {
        const x = c.x + o.x,
          y = c.y + o.y
        if (!inside(x, y)) continue
        const ni = idx(x, y)
        if ((rpm[ni] & mask) !== mask) continue
        const cost = terrain.get(x, y) === 2 ? 6 : 5
        if (d[i] + cost !== d[ni]) continue
        const rest = dp[ni * mc + mask]
        if (rest >= INF) continue
        const cand = tile + rest
        if (cand < best) {
          best = cand
          bt = 2
          bv = ni
        }
      }
      for (let lm = (mask - 1) & mask; lm > 0; lm = (lm - 1) & mask) {
        const rm = mask ^ lm
        if (lm > rm) continue
        const lc = dp[i * mc + lm],
          rc = dp[i * mc + rm]
        if (lc >= INF || rc >= INF) continue
        const cand = lc + rc - tile
        if (cand < best) {
          best = cand
          bt = 3
          bv = lm
        }
      }
      dp[key] = best
      dt[key] = bt
      dv[key] = bv
    }
  }
  const rdp = new Int16Array(mc)
  rdp.fill(INF)
  const rdt = new Uint8Array(mc),
    rdv = new Int16Array(mc)
  rdv.fill(-1)
  const roots = core.roads.map((c) => idx(c.x, c.y))
  for (let mask = 1; mask <= full; mask++) {
    let best = INF,
      bt = 0,
      bv = -1
    for (const i of roots) {
      if ((rpm[i] & mask) !== mask) continue
      const cand = dp[i * mc + mask]
      if (cand < best) {
        best = cand
        bt = 2
        bv = i
      }
    }
    for (let lm = (mask - 1) & mask; lm > 0; lm = (lm - 1) & mask) {
      const rm = mask ^ lm
      if (lm > rm) continue
      const lc = rdp[lm],
        rc = rdp[rm]
      if (lc >= INF || rc >= INF) continue
      const cand = lc + rc
      if (cand < best) {
        best = cand
        bt = 3
        bv = lm
      }
    }
    rdp[mask] = best
    rdt[mask] = bt
    rdv[mask] = bv
  }
  if (rdp[full] >= INF) return
  const roadMask = new Uint8Array(2500),
    st = [{ index: -1, mask: full }]
  while (st.length) {
    const { index: i, mask } = st.pop()
    if (i === -1) {
      const t = rdt[mask],
        v = rdv[mask]
      if (t === 2) st.push({ index: v, mask })
      else if (t === 3) {
        st.push({ index: -1, mask: v }, { index: -1, mask: mask ^ v })
      }
      continue
    }
    if (d[i] > 0) roadMask[i] = 1
    const k = i * mc + mask,
      t = dt[k],
      v = dv[k]
    if (t === 2) st.push({ index: v, mask })
    else if (t === 3) st.push({ index: i, mask: v }, { index: i, mask: mask ^ v })
  }
  const roads = []
  for (let i = 0; i < 2500; i++) if (roadMask[i]) roads.push(coord(i))
  const branches = []
  for (const target of targets) {
    const ri = []
    let i = -1,
      mask = full
    while (true) {
      if (i === -1) {
        const t = rdt[mask],
          v = rdv[mask]
        if (t === 2) {
          i = v
          continue
        }
        if (t === 3) {
          mask = v & target.bit ? v : mask ^ v
          continue
        }
        break
      }
      if (d[i] > 0 && ri[ri.length - 1] !== i) ri.push(i)
      const k = i * mc + mask,
        t = dt[k],
        v = dv[k]
      if (t === 1) break
      if (t === 2) {
        i = v
        continue
      }
      if (t === 3) {
        mask = v & target.bit ? v : mask ^ v
        continue
      }
      break
    }
    branches.push({ targetId: target.targetId, container: target.container, link: target.link, roads: ri.map(coord) })
  }
  return { roads, branches }
}
