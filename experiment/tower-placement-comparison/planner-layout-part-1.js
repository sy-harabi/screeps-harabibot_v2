function planLabs(terrain, controller, sources, minerals, planningMask, ca, core, resourceTree, boundary) {
  const blocked = new Uint8Array(ROOM_AREA),
    block = (c) => (blocked[idx(c.x, c.y)] = 1)
  block(controller.pos)
  block(ca.storage)
  Object.values(ca.upgradeChains).forEach((ch) => ch.forEach(block))
  ;[core.manager, core.terminal, core.firstSpawn, core.link, core.factory, core.powerSpawn, ...core.parking].forEach(
    block,
  )
  ;[...sources, ...minerals].forEach((r) => block(r.pos))
  for (const b of resourceTree.branches) {
    block(b.container)
    if (b.link) block(b.link)
  }
  const baseRoad = new Uint8Array(ROOM_AREA)
  for (const c of [...core.roads, ...resourceTree.roads, ...boundary.roads]) baseRoad[idx(c.x, c.y)] = 1
  const serviceDist = maskDistance(terrain, baseRoad, core.roads)
  const tryLayout = (roadMask, dmap, maxD) => {
    const cd = new Int16Array(ROOM_AREA)
    cd.fill(-1)
    for (let ri = 0; ri < ROOM_AREA; ri++) {
      const rd = dmap[ri]
      if (rd < 0 || rd > maxD || !roadMask[ri]) continue
      const rc = coord(ri)
      for (const o of NEIGHBOR_OFFSETS) {
        const x = rc.x + o.x,
          y = rc.y + o.y
        if (!inside(x, y) || terrain.get(x, y) === 1) continue
        const i = idx(x, y)
        if (blocked[i] || !planningMask[i] || roadMask[i]) continue
        if (cd[i] === -1 || rd < cd[i]) cd[i] = rd
      }
    }
    const cs = []
    for (let i = 0; i < ROOM_AREA; i++) if (cd[i] >= 0) cs.push({ coordinate: coord(i), serviceDistance: cd[i] })
    cs.sort(
      (a, b) =>
        a.serviceDistance - b.serviceDistance ||
        idx(a.coordinate.x, a.coordinate.y) - idx(b.coordinate.x, b.coordinate.y),
    )
    for (let a = 0; a < cs.length - 1; a++)
      for (let b = a + 1; b < cs.length; b++) {
        const A = cs[a].coordinate,
          B = cs[b].coordinate,
          dx = Math.abs(A.x - B.x),
          dy = Math.abs(A.y - B.y)
        if (dx > 4 || dy > 4 || (5 - dx) * (5 - dy) - (Math.max(dx, dy) <= 2 ? 2 : 0) < 8) continue
        const outs = []
        for (let k = 0; k < cs.length; k++) {
          if (k === a || k === b) continue
          const C = cs[k].coordinate
          if (range(C, A) <= 2 && range(C, B) <= 2) {
            outs.push(C)
            if (outs.length === 8) return { inputLabs: [A, B], outputLabs: outs }
          }
        }
      }
  }
  for (let maxD = 0; maxD <= 20; maxD++) {
    let layout = tryLayout(baseRoad, serviceDist, maxD)
    if (layout) return { ...layout, serviceRoads: [] }
    for (let len = 1; len <= 3; len++) {
      if (maxD === 0) continue
      const branchMask = new Uint8Array(ROOM_AREA),
        branch = [],
        seen = new Set()
      const search = (cur, remain) => {
        if (remain === 0) {
          const key = branch
            .map((c) => idx(c.x, c.y))
            .sort((a, b) => a - b)
            .join(",")
          if (seen.has(key)) return
          seen.add(key)
          const rm = baseRoad.slice()
          branch.forEach((c) => (rm[idx(c.x, c.y)] = 1))
          const dm = maskDistance(terrain, rm, core.roads)
          for (const c of branch) {
            const d = dm[idx(c.x, c.y)]
            if (d < 0 || d > maxD) return
          }
          const l = tryLayout(rm, dm, maxD)
          return l ? { ...l, serviceRoads: branch.slice() } : undefined
        }
        for (const o of NEIGHBOR_OFFSETS) {
          const x = cur.x + o.x,
            y = cur.y + o.y
          if (!inside(x, y)) continue
          const i = idx(x, y)
          if (branchMask[i] || baseRoad[i] || blocked[i] || !planningMask[i] || terrain.get(x, y) === 1) continue
          branchMask[i] = 1
          branch.push({ x, y })
          const p = search({ x, y }, remain - 1)
          if (p) return p
          branch.pop()
          branchMask[i] = 0
        }
      }
      for (let si = 0; si < ROOM_AREA; si++) {
        const d = serviceDist[si]
        if (d < 0 || d >= maxD) continue
        const p = search(coord(si), len)
        if (p) return p
      }
    }
  }
}
function maskDistance(terrain, mask, roots) {
  return dijkstraMap(
    terrain,
    roots,
    () => 1,
    (x, y) => mask[idx(x, y)] === 1,
  )
}
