// controller area + core
const LEFT_TURN_ORDER = [-2, -1, 0, 1, 2, 3, 4, 5],
  RIGHT_TURN_ORDER = [2, 1, 0, -1, -2, -3, -4, -5]
function findControllerAreaCandidates(controller, mask) {
  const up = []
  forInRange(controller.pos, 3, (x, y) => {
    if (mask[idx(x, y)]) up.push({ x, y })
  })
  const upSet = new Set(up.map((c) => idx(c.x, c.y)))
  const stor = []
  forAtRange(controller.pos, 4, (x, y) => {
    if (!mask[idx(x, y)]) return
    const s = { x, y },
      dx = Math.sign(x - controller.pos.x),
      dy = Math.sign(y - controller.pos.y),
      start = NEIGHBOR_OFFSETS.findIndex((o) => o.x === dx && o.y === dy),
      roots = []
    for (let i = 0; i < 8; i++) {
      const o = NEIGHBOR_OFFSETS[(start + i) % 8],
        c = { x: x + o.x, y: y + o.y }
      if (upSet.has(idx(c.x, c.y))) roots.push(c)
    }
    if (roots.length >= 3) stor.push({ storage: s, roots: { left: roots[0], middle: roots[1], right: roots[2] } })
  })
  function longest(root, blocked, max = 6) {
    const path = [root],
      vis = new Set([idx(root.x, root.y)])
    let best = [root]
    function dfs(cur) {
      if (path.length > best.length) best = path.slice()
      if (path.length === max) return true
      for (const o of NEIGHBOR_OFFSETS) {
        const n = { x: cur.x + o.x, y: cur.y + o.y }
        if (!inside(n.x, n.y)) continue
        const k = idx(n.x, n.y)
        if (!upSet.has(k) || blocked.has(k) || vis.has(k)) continue
        vis.add(k)
        path.push(n)
        if (dfs(n)) return true
        path.pop()
        vis.delete(k)
      }
      return false
    }
    dfs(root)
    return best
  }
  function follow(root, s, hand, max = 6, blocked) {
    const path = [root],
      vis = new Set([idx(root.x, root.y)])
    let cur = root,
      heading = NEIGHBOR_OFFSETS.findIndex((o) => o.x === Math.sign(root.x - s.x) && o.y === Math.sign(root.y - s.y))
    const order = hand === "left" ? LEFT_TURN_ORDER : RIGHT_TURN_ORDER
    while (path.length < max) {
      let moved = false
      for (const turn of order) {
        const dir = (heading + turn + 8) % 8,
          o = NEIGHBOR_OFFSETS[dir],
          n = { x: cur.x + o.x, y: cur.y + o.y }
        if (!inside(n.x, n.y)) continue
        const k = idx(n.x, n.y)
        if (!upSet.has(k) || vis.has(k) || (blocked && blocked.has(k))) continue
        cur = n
        heading = dir
        path.push(n)
        vis.add(k)
        moved = true
        break
      }
      if (!moved) break
    }
    return path
  }
  function chains(roots, s) {
    let blocked = new Set(Object.values(roots).map((c) => idx(c.x, c.y)))
    const lm = follow(roots.left, s, "left", 6, blocked)
    lm.forEach((c) => blocked.add(idx(c.x, c.y)))
    const rm = follow(roots.right, s, "right", 6, blocked)
    let best = { left: lm, right: rm, middle: [roots.middle] },
      bn = lm.length + rm.length + 1
    for (let ll = lm.length; ll >= 1; ll--)
      for (let rl = rm.length; rl >= 1; rl--) {
        const l = lm.slice(0, ll),
          r = rm.slice(0, rl)
        blocked = new Set([...l, ...r].map((c) => idx(c.x, c.y)))
        const m = longest(roots.middle, blocked, 6)
        if (ll + rl + m.length === 18) return { left: l, right: r, middle: m }
        m.forEach((c) => blocked.add(idx(c.x, c.y)))
        for (const p of [l, r].sort((a, b) => a.length - b.length)) {
          if (p.length === 6) continue
          const ex = longest(p[p.length - 1], blocked, 7 - p.length)
          if (ex.length > 1) {
            p.push(...ex.slice(1))
            ex.forEach((c) => blocked.add(idx(c.x, c.y)))
          }
        }
        const nn = l.length + r.length + m.length
        if (nn === 18) return { left: l, right: r, middle: m }
        if (nn > bn) {
          best = { left: l, right: r, middle: m }
          bn = nn
        }
      }
    return best
  }
  function compact(ch, roots, s) {
    for (const side of ["left", "right"]) {
      const blocked = []
      for (const [n, p] of Object.entries(ch)) if (n !== side) blocked.push(...p)
      const cp = follow(
        roots[side],
        s,
        side === "left" ? "right" : "left",
        6,
        new Set(blocked.map((c) => idx(c.x, c.y))),
      )
      if (cp.length >= ch[side].length) ch[side] = cp
    }
    return ch
  }
  const out = []
  for (const sc of stor) {
    const ch = compact(chains(sc.roots, sc.storage), sc.roots, sc.storage)
    const n = ch.left.length + ch.middle.length + ch.right.length
    out.push({ storage: sc.storage, upgradeChains: ch, tier: n >= 16 ? 1 : n >= 13 ? 2 : 3 })
  }
  return out
}
const CORE_STAMP = {
  terminal: { x: 1, y: 1 },
  manager: { x: 1, y: 0 },
  spawn: { x: 2, y: 1 },
  link: { x: 2, y: -1 },
  linkFallback: { x: 2, y: 0 },
  parking: [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ],
  parkingOptional: { x: -1, y: 0 },
  roads: [
    { x: -1, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
  ],
}
function findCorePlans(cand, mask) {
  const s = cand.storage,
    ch = cand.upgradeChains,
    up = new Set(
      Object.values(ch)
        .flat()
        .map((c) => idx(c.x, c.y)),
    ),
    mid = ch.middle[0],
    res = []
  for (const mirrored of [true, false]) {
    const f = { x: mid.x - s.x, y: mid.y - s.y },
      tr = (p) => {
        const lx = mirrored ? -p.x : p.x,
          rx = -f.y,
          ry = f.x
        return { x: s.x + lx * rx - p.y * f.x, y: s.y + lx * ry - p.y * f.y }
      },
      valid = (c) => inside(c.x, c.y) && mask[idx(c.x, c.y)] && !up.has(idx(c.x, c.y))
    const manager = tr(CORE_STAMP.manager)
    if (!valid(manager)) continue
    const adj = Object.values(ch)
      .filter((a) => a.length && range(manager, a[0]) === 1)
      .sort((a, b) => a.length - b.length)
    if (adj.length < 2) continue
    const terminal = tr(CORE_STAMP.terminal),
      firstSpawn = tr(CORE_STAMP.spawn)
    if (!valid(terminal) || !valid(firstSpawn)) continue
    let link = tr(CORE_STAMP.link)
    if (!valid(link)) {
      link = tr(CORE_STAMP.linkFallback)
      if (!valid(link)) continue
    }
    const parking = CORE_STAMP.parking.map(tr)
    if (parking.some((c) => !valid(c))) continue
    const op = tr(CORE_STAMP.parkingOptional)
    if (valid(op)) parking.push(op)
    const roads = CORE_STAMP.roads.map(tr)
    if (roads.some((c) => !valid(c))) continue
    res.push({
      manager,
      terminal,
      firstSpawn,
      link,
      factory: adj[0][0],
      powerSpawn: adj[adj.length - 1][0],
      parking,
      roads,
    })
  }
  return res
}
