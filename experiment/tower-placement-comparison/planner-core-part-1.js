// Browser port of sy-harabi/screeps-harabibot_v2 base planner
// Snapshot: 7187a4579284bc27010db9b72740451b4f5d430b
const ROOM_SIZE = 50,
  ROOM_AREA = 2500
const TERRAIN_MASK_WALL = 1,
  TERRAIN_MASK_SWAMP = 2
const NEIGHBOR_OFFSETS = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
]
const idx = (x, y) => y * 50 + x,
  coord = (i) => ({ x: i % 50, y: Math.floor(i / 50) }),
  inside = (x, y) => x >= 0 && x < 50 && y >= 0 && y < 50
const range = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
function forInRange(c, r, fn) {
  const minX = Math.max(0, c.x - r),
    maxX = Math.min(49, c.x + r),
    minY = Math.max(0, c.y - r),
    maxY = Math.min(49, c.y + r)
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) fn(x, y)
}
function forAtRange(c, r, fn) {
  if (r === 0) {
    if (inside(c.x, c.y)) fn(c.x, c.y)
    return
  }
  const l = c.x - r,
    rr = c.x + r,
    t = c.y - r,
    b = c.y + r,
    minX = Math.max(0, l),
    maxX = Math.min(49, rr),
    minY = Math.max(0, t),
    maxY = Math.min(49, b)
  for (let x = minX; x <= maxX; x++) {
    if (t >= 0 && t < 50) fn(x, t)
    if (b >= 0 && b < 50) fn(x, b)
  }
  for (let y = minY; y <= maxY; y++) {
    if (y === t || y === b) continue
    if (l >= 0 && l < 50) fn(l, y)
    if (rr >= 0 && rr < 50) fn(rr, y)
  }
}
class Terrain {
  constructor(s) {
    this.s = s
  }
  get(x, y) {
    const v = this.s[idx(x, y)]
    return v === undefined ? 1 : typeof v === "string" ? Number(v) : v
  }
}
class PriorityQueue {
  constructor() {
    this.h = []
    this.o = 0
  }
  get size() {
    return this.h.length
  }
  comes(a, b) {
    return a.p !== b.p ? a.p > b.p : a.o < b.o
  }
  push(v, p) {
    const e = { v, p, o: this.o++ }
    this.h.push(e)
    let i = this.h.length - 1
    while (i > 0) {
      const q = Math.floor((i - 1) / 2)
      if (!this.comes(this.h[i], this.h[q])) break
      ;[this.h[i], this.h[q]] = [this.h[q], this.h[i]]
      i = q
    }
  }
  pop() {
    if (!this.h.length) return
    const r = this.h[0],
      l = this.h.pop()
    if (this.h.length) {
      this.h[0] = l
      let i = 0
      for (;;) {
        let b = i,
          le = i * 2 + 1,
          ri = le + 1
        if (le < this.h.length && this.comes(this.h[le], this.h[b])) b = le
        if (ri < this.h.length && this.comes(this.h[ri], this.h[b])) b = ri
        if (b === i) break
        ;[this.h[i], this.h[b]] = [this.h[b], this.h[i]]
        i = b
      }
    }
    return r.v
  }
}
function floodFill(terrain, starts, canVisit) {
  const d = new Int16Array(ROOM_AREA)
  d.fill(-1)
  const q = []
  for (const s of starts) {
    if (!inside(s.x, s.y) || terrain.get(s.x, s.y) === 1 || (canVisit && !canVisit(s.x, s.y))) continue
    const i = idx(s.x, s.y)
    if (d[i] !== -1) continue
    d[i] = 0
    q.push(i)
  }
  for (let h = 0; h < q.length; h++) {
    const ci = q[h],
      c = coord(ci)
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (!inside(x, y)) continue
      const ni = idx(x, y)
      if (d[ni] !== -1 || terrain.get(x, y) === 1 || (canVisit && !canVisit(x, y))) continue
      d[ni] = d[ci] + 1
      q.push(ni)
    }
  }
  return { distances: d, visitedIndices: q }
}
function dijkstraMap(terrain, starts, getCost, canVisit) {
  const d = new Int32Array(ROOM_AREA)
  d.fill(-1)
  const pq = new PriorityQueue(),
    seen = new Uint8Array(ROOM_AREA)
  for (const c of starts) {
    if (!inside(c.x, c.y) || terrain.get(c.x, c.y) === 1 || (canVisit && !canVisit(c.x, c.y))) continue
    const i = idx(c.x, c.y)
    if (d[i] !== -1) continue
    d[i] = 0
    pq.push(i, 0)
  }
  while (pq.size) {
    const i = pq.pop()
    if (seen[i]) continue
    seen[i] = 1
    const c = coord(i),
      base = d[i]
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (!inside(x, y)) continue
      const tt = terrain.get(x, y)
      if (tt === 1 || (canVisit && !canVisit(x, y))) continue
      const ni = idx(x, y),
        nd = base + getCost(x, y, tt)
      if (d[ni] !== -1 && nd >= d[ni]) continue
      d[ni] = nd
      pq.push(ni, -nd)
    }
  }
  return d
}
function distanceTransform(terrain) {
  const a = new Uint8Array(ROOM_AREA)
  const F = [
      [-1, 0],
      [0, -1],
      [-1, -1],
      [-1, 1],
    ],
    B = [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) a[idx(x, y)] = terrain.get(x, y) === 1 ? 0 : 255
  for (let x = 0; x < 50; x++)
    for (let y = 0; y < 50; y++) {
      let m = a[idx(x, y)]
      for (const [dx, dy] of F) {
        const xx = x + dx,
          yy = y + dy
        if (inside(xx, yy)) m = Math.min(m, a[idx(xx, yy)] + 1)
      }
      a[idx(x, y)] = m
    }
  for (let x = 49; x >= 0; x--)
    for (let y = 49; y >= 0; y--) {
      let m = a[idx(x, y)]
      for (const [dx, dy] of B) {
        const xx = x + dx,
          yy = y + dy
        if (inside(xx, yy)) m = Math.min(m, a[idx(xx, yy)] + 1)
      }
      a[idx(x, y)] = m
    }
  return a
}
class Dinic {
  constructor(n) {
    this.g = Array.from({ length: n }, () => [])
  }
  addEdge(f, t, c) {
    const a = { to: t, rev: this.g[t].length, cap: c },
      b = { to: f, rev: this.g[f].length, cap: 0 }
    this.g[f].push(a)
    this.g[t].push(b)
  }
  levels(s, t, l) {
    l.fill(-1)
    const q = new Int32Array(this.g.length)
    let h = 0,
      z = 0
    l[s] = 0
    q[z++] = s
    while (h < z) {
      const n = q[h++]
      for (const e of this.g[n])
        if (e.cap > 0 && l[e.to] === -1) {
          l[e.to] = l[n] + 1
          q[z++] = e.to
        }
    }
    return l[t] !== -1
  }
  send(n, t, m, l, next) {
    if (n === t) return m
    const es = this.g[n]
    for (; next[n] < es.length; next[n]++) {
      const e = es[next[n]]
      if (e.cap <= 0 || l[e.to] !== l[n] + 1) continue
      const p = this.send(e.to, t, Math.min(m, e.cap), l, next)
      if (p > 0) {
        e.cap -= p
        this.g[e.to][e.rev].cap += p
        return p
      }
    }
    return 0
  }
  maxFlow(s, t, stop) {
    let total = 0
    const l = new Int16Array(this.g.length),
      next = new Int32Array(this.g.length)
    while (this.levels(s, t, l)) {
      next.fill(0)
      while (total < stop) {
        const p = this.send(s, t, stop - total, l, next)
        if (!p) break
        total += p
      }
      if (total >= stop) break
    }
    return total
  }
  reachable(s) {
    const r = new Uint8Array(this.g.length),
      q = new Int32Array(this.g.length)
    let h = 0,
      z = 0
    r[s] = 1
    q[z++] = s
    while (h < z) {
      const n = q[h++]
      for (const e of this.g[n])
        if (e.cap > 0 && !r[e.to]) {
          r[e.to] = 1
          q[z++] = e.to
        }
    }
    return r
  }
}
function minCut(terrain, source, sink, costs) {
  let finite = 0
  for (let i = 0; i < 2500; i++) {
    const c = coord(i)
    if (terrain.get(c.x, c.y) !== 1) finite += costs?.[i] ?? 1
  }
  const INF = finite + 1,
    S = 5000,
    T = 5001,
    f = new Dinic(5002)
  let ns = 0,
    nt = 0
  for (let i = 0; i < 2500; i++) {
    const c = coord(i)
    if (terrain.get(c.x, c.y) === 1) continue
    if (source[i] && sink[i]) return
    const inn = i * 2,
      out = inn + 1,
      tc = source[i] ? INF : (costs?.[i] ?? 1)
    f.addEdge(inn, out, tc)
    if (source[i]) {
      f.addEdge(S, inn, INF)
      ns++
    }
    if (sink[i]) {
      f.addEdge(inn, T, INF)
      nt++
    }
    for (const o of NEIGHBOR_OFFSETS) {
      const x = c.x + o.x,
        y = c.y + o.y
      if (inside(x, y) && terrain.get(x, y) !== 1) f.addEdge(out, idx(x, y) * 2, INF)
    }
  }
  if (!ns || !nt) return
  const flow = f.maxFlow(S, T, INF)
  if (flow >= INF) return
  const reach = f.reachable(S),
    cut = new Uint8Array(2500),
    ins = new Uint8Array(2500),
    outm = new Uint8Array(2500),
    cuts = []
  let totalCost = 0
  for (let i = 0; i < 2500; i++) {
    const c = coord(i)
    if (terrain.get(c.x, c.y) === 1) continue
    const ir = !!reach[i * 2],
      or = !!reach[i * 2 + 1]
    if (ir && !or) {
      cut[i] = 1
      cuts.push(c)
      totalCost += costs?.[i] ?? 1
    } else if (ir && or) ins[i] = 1
    else outm[i] = 1
  }
  return { cuts, cutMask: cut, insideMask: ins, outsideMask: outm, totalCost }
}
