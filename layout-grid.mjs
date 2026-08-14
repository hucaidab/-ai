// ============================================================
// layout-grid.mjs — 自研网格布局器（零依赖）
// 模式：
//   auto      —— 无 subgraph 的常规流程图：拓扑分层（TD），回边右侧绕行
//   swimlane  —— 有 subgraph 的泳道图：列=组（部门/角色），行=组内节点顺序
//                （复杂泳道不再依赖 ELK/Graphviz，坐标完全可控）
// 输出统一结构：{ nodes:[{id,x,y,w,h,label,shape,cls}], edges:[{...points,label,style,back}], width, height }
// ============================================================

// ---------- 布局常量 ----------
const MARGIN = 50
const NODE_W = 176, NODE_H = 54
const DM_W = 196, DM_H = 90
const EL_W = 190, EL_H = 50
const ROW_H = 138          // auto 行高
const LAYER_GAP = 70       // auto 层间距（含回边空间）
const COL_W = 260          // swimlane 列宽
const COL_GAP = 84         // swimlane 列间距
const SROW_H = 124         // swimlane 行高
const HEAD_H = 44          // swimlane 组头高

const nodeSize = n => {
  if (n.shape === 'diamond') return [DM_W, DM_H]
  if (n.shape === 'stadium' || n.shape === 'ellipse') return [EL_W, EL_H]
  return [NODE_W, NODE_H]
}

// ---------- 模式一：自动分层（TD） ----------
export function layoutAuto(nodes, edges) {
  const idSet = new Set(nodes.map(n => n.id))
  const adj = new Map(); nodes.forEach(n => adj.set(n.id, []))
  const indeg = new Map(); nodes.forEach(n => indeg.set(n.id, 0))
  edges.forEach(e => {
    // 逆向/虚线边不参与分层（避免环），仅作回边渲染
    if (e.style === 'dotted' || e.back) return
    if (idSet.has(e.from) && idSet.has(e.to)) {
      adj.get(e.from).push(e.to)
      indeg.set(e.to, (indeg.get(e.to) || 0) + 1)
    }
  })
  // Kahn 拓扑分层
  const rank = new Map()
  const queue = [...nodes.filter(n => (indeg.get(n.id) || 0) === 0).map(n => n.id)]
  let order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const t of adj.get(id)) {
      indeg.set(t, indeg.get(t) - 1)
      if (indeg.get(t) === 0) queue.push(t)
    }
  }
  // 环内节点补层
  const remaining = nodes.filter(n => !order.includes(n.id)).map(n => n.id)
  order = order.concat(remaining)
  const maxR = new Map()
  nodes.forEach(n => maxR.set(n.id, 0))
  for (const id of order) {
    const r = maxR.get(id)
    rank.set(id, r)
    for (const t of adj.get(id)) {
      if (maxR.get(t) < r + 1) maxR.set(t, r + 1)
    }
  }
  const layerCount = Math.max(0, ...nodes.map(n => rank.get(n.id) || 0)) + 1
  // 每层节点按声明顺序
  const layers = Array.from({ length: layerCount }, () => [])
  nodes.forEach(n => layers[rank.get(n.id) || 0].push(n))
  // 计算位置
  let maxW = 0
  const pos = {}
  layers.forEach((layer, li) => {
    const ys = MARGIN + li * (ROW_H + LAYER_GAP) + (LAYER_GAP > 0 ? 0 : 0)
    const totalW = layer.reduce((s, n) => s + nodeSize(n)[0], 0) + (layer.length - 1) * 36
    let x = MARGIN
    layer.forEach(n => {
      const [w, h] = nodeSize(n)
      pos[n.id] = { x: x + (w - w) / 2, y: ys + (ROW_H - h) / 2, cx: x + w / 2, cy: ys + ROW_H / 2, w, h }
      x += w + 36
    })
    maxW = Math.max(maxW, x - 36 + MARGIN)
  })
  const height = MARGIN * 2 + layerCount * (ROW_H + LAYER_GAP) - LAYER_GAP
  // 边路由
  const routed = edges.map(e => {
    const A = pos[e.from], B = pos[e.to]
    const back = (A.cy + A.h / 2) >= (B.cy - B.h / 2) && e.from !== e.to && (A.cy) > (B.cy)
    let pts
    if (back) {
      const rx = Math.max(A.x + A.w, B.x + B.w) + 46
      pts = [[A.x + A.w, A.cy], [rx, A.cy], [rx, B.cy], [B.x + B.w, B.cy]]
    } else {
      const ym = (A.y + A.h + B.y) / 2
      pts = [[A.cx, A.y + A.h], [A.cx, ym], [B.cx, ym], [B.cx, B.y]]
    }
    return { ...e, points: pts, back }
  })
  return { nodes: nodes.map(n => ({ ...n, ...pos[n.id] })), edges: routed, width: maxW, height, mode: 'auto' }
}

// ---------- 模式二：泳道（列=组） ----------
export function layoutSwimlane(nodes, edges, groups, declaredOrder) {
  // 组内节点按声明顺序；未分组节点放独立"未分组"列
  const groupIds = groups.map(g => g.id)
  const grouped = new Set()
  groups.forEach(g => g.nodeIds.forEach(id => grouped.add(id)))
  const ungrouped = nodes.filter(n => !grouped.has(n.id))
  const cols = groups.map(g => ({ id: g.id, label: g.label, nodeIds: g.nodeIds.filter(id => nodes.some(n => n.id === id)) }))
  if (ungrouped.length) cols.push({ id: '__free__', label: '未分组', nodeIds: ungrouped.map(n => n.id) })
  // 列 x
  const colX = []
  let acc = MARGIN
  cols.forEach((c, i) => { colX.push(acc); acc += COL_W + COL_GAP })
  const width = acc - COL_GAP + MARGIN
  // 行 y（组内按声明顺序）
  const pos = {}
  let maxRows = 0
  cols.forEach((c, ci) => {
    c.nodeIds.forEach((id, ri) => {
      const n = nodes.find(x => x.id === id)
      if (!n) return
      const [w, h] = nodeSize(n)
      const y = MARGIN + HEAD_H + ri * SROW_H + (SROW_H - h) / 2
      pos[id] = { x: colX[ci] + (COL_W - w) / 2, y, cx: colX[ci] + COL_W / 2, cy: y + h / 2, w, h }
      maxRows = Math.max(maxRows, ri + 1)
    })
  })
  const height = MARGIN * 2 + HEAD_H + maxRows * SROW_H + 20
  // 组 id → 列下标
  const colOf = {}
  cols.forEach((c, ci) => colOf[c.id] = ci)
  const colIndexOfNode = n => {
    const g = groups.find(g => g.nodeIds.includes(n.id))
    return g ? colOf[g.id] : colOf['__free__']
  }
  // 边路由：同列垂直；跨列走通道（顺流右、回流左）
  const routed = edges.map(e => {
    const A = pos[e.from], B = pos[e.to]
    if (!A || !B) return { ...e, points: [], back: false }
    const ai = colIndexOfNode(nodes.find(n => n.id === e.from))
    const bi = colIndexOfNode(nodes.find(n => n.id === e.to))
    let pts
    if (ai === bi) {
      if (B.cy > A.cy) pts = [[A.cx, A.y + A.h], [A.cx, B.y]]
      else pts = [[A.cx, A.y], [A.cx, B.y + B.h]]
    } else if (bi > ai) {
      const chX = colX[ai] + COL_W + COL_GAP / 2
      pts = [[A.x + A.w, A.cy], [chX, A.cy], [chX, B.cy], [B.x, B.cy]]
    } else {
      const chX = colX[ai] - COL_GAP / 2
      pts = [[A.x, A.cy], [chX, A.cy], [chX, B.cy], [B.x + B.w, B.cy]]
    }
    return { ...e, points: pts, back: bi < ai }
  })
  return { nodes: nodes.map(n => ({ ...n, ...pos[n.id] })), edges: routed, width, height, mode: 'swimlane', cols }
}

// ---------- 模式自动选择 ----------
export function layout(nodes, edges, groups, declaredOrder, mode) {
  const hasGroups = groups.some(g => g.nodeIds.length >= 2)
  const useSwim = mode === 'swimlane' || (mode === 'auto' && hasGroups)
  return useSwim
    ? layoutSwimlane(nodes, edges, groups, declaredOrder)
    : layoutAuto(nodes, edges)
}

// ---------- 锚点边路由（对齐 draw.io 锚点机制） ----------
// 8 方向锚点（相对坐标 0-1，节点本地坐标系）：线从节点边界出发，杜绝穿节点
const ANCHOR_REL = {
  e: [1, 0.5], se: [1, 0.75], s: [0.5, 1], sw: [0, 0.75],
  w: [0, 0.5], nw: [0, 0.25], n: [0.5, 0], ne: [1, 0.25],
}
const DIRS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']

// 节点当前坐标（pos 手动覆盖优先，无 pos 用布局坐标）——坐标源统一
function nodeXY(n) {
  return { x: n.pos ? n.pos.x : n.x, y: n.pos ? n.pos.y : n.y }
}

// 取节点某方向的锚点绝对坐标
export function anchorPoint(n, dir) {
  const [rx, ry] = ANCHOR_REL[dir] || ANCHOR_REL.e
  const p = nodeXY(n)
  return { x: p.x + rx * n.w, y: p.y + ry * n.h }
}

// 向量 (dx,dy) 归到最近 8 方向（角度 bucket，每 45°）
function dirFromVector(dx, dy) {
  let deg = Math.atan2(dy, dx) * 180 / Math.PI // -180~180，0=正右
  if (deg < 0) deg += 360
  return DIRS[Math.round(deg / 45) % 8]
}

// A→B 正交路由：出口=A 方向锚点，入口=B 反向锚点，Z 型（2 折点）
// obstacles：其他节点列表（自动过滤 A/B），Z 型中段碰撞时偏移绕行（避障）
export function routeEdgePoints(A, B, obstacles = []) {
  const ax = nodeXY(A).x, ay = nodeXY(A).y
  const bx = nodeXY(B).x, by = nodeXY(B).y
  const acx = ax + A.w / 2, acy = ay + A.h / 2
  const bcx = bx + B.w / 2, bcy = by + B.h / 2
  const dx = bcx - acx, dy = bcy - acy
  if (dx === 0 && dy === 0) return [[acx, acy], [bcx, bcy]] // 重合退化：直接连接
  const p1 = anchorPoint(A, dirFromVector(dx, dy))   // 出口
  const p2 = anchorPoint(B, dirFromVector(-dx, -dy)) // 入口（反向）
  // 障碍物（按 id 排除 A/B 自身，坐标统一 pos 优先）
  const obsBoxes = obstacles
    .filter(o => !o.id || (o.id !== A.id && o.id !== B.id))
    .map(o => { const p = nodeXY(o); return { x: p.x, y: p.y, w: o.w, h: o.h } })
  // 主轴候选 + 备选主轴（主轴避不开时切换另一主轴，处理水平段被挡场景）
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const builds = horizontal
    ? [[p1, p2, true], [p1, p2, false]]
    : [[p1, p2, false], [p1, p2, true]]
  for (const [a, b, isH] of builds) {
    const mid = isH ? (a.x + b.x) / 2 : (a.y + b.y) / 2
    let pts = isH
      ? [[a.x, a.y], [mid, a.y], [mid, b.y], [b.x, b.y]]
      : [[a.x, a.y], [a.x, mid], [b.x, mid], [b.x, b.y]]
    if (obsBoxes.length) pts = avoidMiddle(pts, isH, obsBoxes)
    if (!routeHits(pts, obsBoxes)) return pts
  }
  // 双主轴都避不开：返回主轴原始路由（保底）
  const mid = horizontal ? (p1.x + p2.x) / 2 : (p1.y + p2.y) / 2
  return horizontal
    ? [[p1.x, p1.y], [mid, p1.y], [mid, p2.y], [p2.x, p2.y]]
    : [[p1.x, p1.y], [p1.x, mid], [p2.x, mid], [p2.x, p2.y]]
}

const GAP = 16 // 绕行间隙

// 线段与 AABB 相交（轴对齐线段）
function segHitsBox(x0, y0, x1, y1, box) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1)
  return maxX >= box.x && minX <= box.x + box.w && maxY >= box.y && minY <= box.y + box.h
}

// 折线是否与任一障碍相交
function routeHits(pts, boxes) {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const o of boxes) {
      if (segHitsBox(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o)) return true
    }
  }
  return false
}

// 中段避障：水平 Z 型把垂直段 x=mid 偏移绕行；垂直 Z 型把水平段 y=mid 偏移（迭代≤3 轮）
function avoidMiddle(pts, isH, boxes) {
  let out = pts
  for (let round = 0; round < 3; round++) {
    // 中段 = out[1]→out[2]（垂直段或水平段）
    const x0 = out[1][0], y0 = out[1][1], x1 = out[2][0], y1 = out[2][1]
    const hit = boxes.filter(o => segHitsBox(x0, y0, x1, y1, o))
    if (!hit.length) return out
    let m = isH ? x0 : y0
    for (const o of hit) {
      const lo = (isH ? o.x : o.y) - GAP
      const hi = (isH ? o.x + o.w : o.y + o.h) + GAP
      m = Math.abs(m - lo) <= Math.abs(m - hi) ? lo : hi
    }
    out = isH
      ? [[out[0][0], out[0][1]], [m, out[0][1]], [m, out[3][1]], [out[3][0], out[3][1]]]
      : [[out[0][0], out[0][1]], [out[0][0], m], [out[3][0], m], [out[3][0], out[3][1]]]
  }
  return out
}

// 基于 lay.nodes 当前坐标（已含 pos 覆盖）重算全部边路由——
// 节点被拖拽/pos 覆盖后边必须跟随，否则节点在 pos 边连旧位置（视觉断线）
// 其余节点作为障碍参与避障（不穿其他节点）
export function rerouteEdges(lay) {
  const byId = new Map(lay.nodes.map(n => [n.id, n]))
  lay.edges.forEach(e => {
    const a = byId.get(e.from), b = byId.get(e.to)
    if (!a || !b) return
    e.points = routeEdgePoints(a, b, lay.nodes)
  })
  return lay
}
