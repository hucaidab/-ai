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

// ---------- 模式二：泳道（树形容器：角色横向分栏 + 任意深度嵌套，draw.io 风格） ----------
// lanes = req.lanes（{dept, roles[], children[]}）——单一数据源（groups 只有 label/nodeIds，无 roles/层级语义）
const MIN_LANE_W = 220   // 空泳道最小宽
const MIN_LANE_H = 110   // 空泳道最小高
const ROLE_GAP = 10      // 泳道内角色栏间距

export function layoutSwimlane(nodes, edges, groups, declaredOrder, lanes, reqNodes) {
  // reqNodes 可选：注入 dept/role（parse 节点无这些语义字段，源在 req.nodes——单一数据源）
  if (reqNodes && reqNodes.length) {
    nodes = nodes.map(n => { const rn = reqNodes.find(x => x.id === n.id); return rn ? { ...n, dept: rn.dept, role: rn.role } : n })
  }
  if (!lanes || !lanes.length) return legacySwimlane(nodes, edges, groups, declaredOrder) // mmd 直渲（无 req）fallback
  const byId = new Map(nodes.map(n => [n.id, n]))
  // 递归布局泳道树：返回 { id, label, x, y, w, h, children[], roleCols[], nodeIds[] }
  const layoutLane = (lane, depth, offsetX, offsetY) => {
    const children = (lane.children || []).map(cl => layoutLane(cl, depth + 1, 0, 0))
    // 本层节点（dept 精确匹配当前泳道，且不属子泳道）
    const laneNodes = nodes.filter(n => n.dept === lane.dept && !(lane.children || []).some(c => c.dept === n.dept))
    // 角色栏：roles 声明驱动（横向并排），栏内节点垂直堆叠
    const roles = lane.roles && lane.roles.length ? lane.roles : ['默认']
    let roleCols = roles.map(role => {
      const ns = laneNodes.filter(n => (n.role || '默认') === role)
      const maxH = Math.max(...ns.map(n => nodeSize(n)[1]), 0)
      const colH = Math.max(HEAD_H + ns.length * SROW_H + 20, maxH + 40, MIN_LANE_H)
      // 栏内节点定位（垂直堆叠，居中）
      ns.forEach((n, ri) => {
        const [w, h] = nodeSize(n)
        pos[n.id] = { x: 0, y: 0, cx: 0, cy: 0, w, h, _role: role, _lane: lane.dept } // x/y 待列偏移后定
        rowOrder.push({ id: n.id, role, ri })
      })
      return { kind: 'role', label: role, nodeIds: ns.map(n => n.id), w: COL_W, h: colH }
    })
    // 内容区：子泳道 + 角色栏 横向并排
    const parts = [...children, ...roleCols]
    const contentW = parts.length ? parts.reduce((a, c) => a + c.w, 0) + (parts.length - 1) * ROLE_GAP : MIN_LANE_W
    const contentH = parts.length ? Math.max(...parts.map(c => c.h)) : MIN_LANE_H
    const w = Math.max(contentW, MIN_LANE_W)
    const h = HEAD_H + contentH
    return { id: lane.dept, label: lane.dept, x: 0, y: 0, w, h, children, roleCols, nodeIds: laneNodes.map(n => n.id) }
  }
  const pos = {}, rowOrder = []
  const lanesTree = lanes.map((l, i) => layoutLane(l, 0, 0, 0))
  // 拼接 x/y（顶层横向；泳道内 children+roleCols 横向；栏内节点垂直）
  const placeLane = (node, x0, y0) => {
    node.x = x0; node.y = y0
    let accX = x0 + ROLE_GAP
    node.children.forEach(c => { placeLane(c, accX, y0 + HEAD_H); accX += c.w + ROLE_GAP })
    node.roleCols.forEach(rc => {
      rc.x = accX; rc.y = y0 + HEAD_H
      // 栏内节点垂直堆叠（按 rowOrder 顺序）
      const ns = rc.nodeIds.map(id => byId.get(id)).filter(Boolean)
      ns.forEach((n, ri) => {
        const p = pos[n.id]
        const cx = rc.x + rc.w / 2
        const y = rc.y + HEAD_H + ri * SROW_H + (SROW_H - p.h) / 2
        p.x = cx - p.w / 2; p.y = y; p.cx = cx; p.cy = y + p.h / 2
      })
      accX += rc.w + ROLE_GAP
    })
  }
  let accX = MARGIN
  lanesTree.forEach(t => { placeLane(t, accX, MARGIN); accX += t.w + COL_GAP })
  const width = accX - COL_GAP + MARGIN
  const height = Math.max(...lanesTree.map(t => t.y + t.h), MARGIN * 2) + 20
  // 节点 pos 应用（x/y 已在上方计算）
  const placed = nodes.map(n => ({ ...n, ...pos[n.id] }))
  // 边路由：按节点所在顶层泳道列索引（跨列走通道；同列垂直）
  const topIndexOf = n => {
    for (let i = 0; i < lanesTree.length; i++) if (containsLane(lanesTree[i], n.dept)) return i
    return 0
  }
  const colX = []
  let acc = MARGIN
  lanesTree.forEach(t => { colX.push(acc); acc += t.w + COL_GAP })
  const routed = edges.map(e => {
    const A = pos[e.from], B = pos[e.to]
    if (!A || !B) return { ...e, points: [], back: false }
    const ai = topIndexOf(byId.get(e.from)), bi = topIndexOf(byId.get(e.to))
    let pts
    if (ai === bi) {
      if (B.cy > A.cy) pts = [[A.cx, A.y + A.h], [A.cx, B.y]]
      else pts = [[A.cx, A.y], [A.cx, B.y + B.h]]
    } else if (bi > ai) {
      const chX = colX[ai] + lanesTree[ai].w + COL_GAP / 2
      pts = [[A.x + A.w, A.cy], [chX, A.cy], [chX, B.cy], [B.x, B.cy]]
    } else {
      const chX = colX[ai] - COL_GAP / 2
      pts = [[A.x, A.cy], [chX, A.cy], [chX, B.cy], [B.x + B.w, B.cy]]
    }
    return { ...e, points: pts, back: bi < ai }
  })
  return { nodes: placed, edges: routed, width, height, mode: 'swimlane', cols: lanesTree }
}

// 泳道树是否包含指定 dept（任意深度）
function containsLane(lane, dept) {
  if (lane.label === dept) return true
  return (lane.children || []).some(c => containsLane(c, dept))
}

// 旧扁平泳道布局（无 req.lanes 时的 mmd 直渲 fallback：列=组，组内节点垂直堆叠）
function legacySwimlane(nodes, edges, groups, declaredOrder) {
  const groupIds = groups.map(g => g.id)
  const grouped = new Set()
  groups.forEach(g => g.nodeIds.forEach(id => grouped.add(id)))
  const ungrouped = nodes.filter(n => !grouped.has(n.id))
  const cols = groups.map(g => ({ id: g.id, label: g.label, nodeIds: g.nodeIds.filter(id => nodes.some(n => n.id === id)) }))
  if (ungrouped.length) cols.push({ id: '__free__', label: '未分组', nodeIds: ungrouped.map(n => n.id) })
  const colX = []
  let acc = MARGIN
  cols.forEach((c, i) => { colX.push(acc); acc += COL_W + COL_GAP })
  const width = acc - COL_GAP + MARGIN
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
  const colOf = {}
  cols.forEach((c, ci) => colOf[c.id] = ci)
  const colIndexOfNode = n => {
    const g = groups.find(g => g.nodeIds.includes(n.id))
    return g ? colOf[g.id] : colOf['__free__']
  }
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
  // 输出兼容新树形结构的 cols（render-svg 统一渲染：每列 = 泳道，roleCols 默认一栏）
  const treeCols = cols.map((c, ci) => {
    const h = MARGIN * 2 + HEAD_H + c.nodeIds.length * SROW_H + 20
    return {
      id: c.id, label: c.label, x: colX[ci], y: MARGIN, w: COL_W, h,
      children: [],
      roleCols: c.nodeIds.length ? [{ label: c.label, x: colX[ci], y: MARGIN + HEAD_H, w: COL_W, h: h - HEAD_H, nodeIds: c.nodeIds }] : [],
      nodeIds: c.nodeIds,
    }
  })
  return { nodes: nodes.map(n => ({ ...n, ...pos[n.id] })), edges: routed, width, height, mode: 'swimlane', cols: treeCols }
}

// ---------- 模式自动选择 ----------
export function layout(nodes, edges, groups, declaredOrder, mode, lanes, reqNodes) {
  const hasGroups = groups.some(g => g.nodeIds.length >= 2)
  const useSwim = mode === 'swimlane' || (mode === 'auto' && (hasGroups || (lanes && lanes.length)))
  return useSwim
    ? layoutSwimlane(nodes, edges, groups, declaredOrder, lanes, reqNodes)
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

// ---------- 同对边平行偏移（双向边/同向多边不重叠，对齐 draw.io/ProcessOn） ----------
// 同一对节点（A↔B，方向无关）的多条边：mid 折点按序错开 ±24px，形成平行线
export function edgeOffsets(edges) {
  const groups = new Map()
  edges.forEach(e => {
    const key = [e.from, e.to].sort().join('↔')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(e)
  })
  const map = new Map()
  groups.forEach(group => {
    const n = group.length
    if (n < 2) return
    group.forEach((e, idx) => map.set(e, (idx - (n - 1) / 2) * 24))
  })
  return map
}

// A→B 正交路由：出口=A 方向锚点，入口=B 反向锚点，Z 型（2 折点）
// obstacles：其他节点列表（自动过滤 A/B），Z 型中段碰撞时偏移绕行（避障）
// offset：同对边平行偏移量（mid 折点错开，多边不重叠）
export function routeEdgePoints(A, B, obstacles = [], offset = 0) {
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
    const mid = (isH ? (a.x + b.x) / 2 : (a.y + b.y) / 2) + offset
    let pts = isH
      ? [[a.x, a.y], [mid, a.y], [mid, b.y], [b.x, b.y]]
      : [[a.x, a.y], [a.x, mid], [b.x, mid], [b.x, b.y]]
    if (obsBoxes.length) pts = avoidMiddle(pts, isH, obsBoxes)
    if (!routeHits(pts, obsBoxes)) return pts
  }
  // 双主轴都避不开：返回主轴原始路由（保底）
  const mid = (horizontal ? (p1.x + p2.x) / 2 : (p1.y + p2.y) / 2) + offset
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

// ---------- 航点路由（draw.io waypoints：用户手拖的必经折点） ----------
// 两点间正交连接：共线（同 x 或同 y）直接直线（无中点），否则单 L 型（主轴折中）
function orthoLink(ax, ay, bx, by) {
  if (ax === bx || ay === by) return [[ax, ay], [bx, by]] // 共线：直线
  if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
    const midX = (ax + bx) / 2
    return [[ax, ay], [midX, ay], [midX, by], [bx, by]]
  }
  const midY = (ay + by) / 2
  return [[ax, ay], [ax, midY], [bx, midY], [bx, by]]
}

// 带航点路由：出口 → wp1 → wp2 → … → 入口（逐段正交连接，相邻重复点合并）
export function routeWithWaypoints(p1, p2, wp) {
  const pts = [[p1.x, p1.y]]
  let prev = [p1.x, p1.y]
  const append = seg => {
    for (const pt of seg.slice(1)) {
      const last = pts[pts.length - 1]
      if (pt[0] !== last[0] || pt[1] !== last[1]) pts.push(pt) // 相邻去重
    }
  }
  for (const w of wp) {
    append(orthoLink(prev[0], prev[1], w[0], w[1]))
    prev = [w[0], w[1]]
  }
  append(orthoLink(prev[0], prev[1], p2.x, p2.y))
  return pts
}

// 基于 lay.nodes 当前坐标（已含 pos 覆盖）重算全部边路由——
// 节点被拖拽/pos 覆盖后边必须跟随，否则节点在 pos 边连旧位置（视觉断线）
// reqEdges：原始 req.edges（wp 航点数据源，lay.edges 是解析产物无 wp）
// 带 wp 的边走航点路由（wp 绝对坐标必经），其余走锚点+避障路由
export function rerouteEdges(lay, reqEdges) {
  const byId = new Map(lay.nodes.map(n => [n.id, n]))
  // req 边 → wp 映射（from→to+label 键）
  const wpMap = new Map()
  if (reqEdges) reqEdges.forEach(e => { if (e.wp && e.wp.length) wpMap.set(e.from + '→' + e.to + '|' + (e.label || ''), e.wp) })
  // 同对边平行偏移（双向/同向多边不重叠）
  const offsets = edgeOffsets(lay.edges)
  lay.edges.forEach(e => {
    const a = byId.get(e.from), b = byId.get(e.to)
    if (!a || !b) return
    const wp = wpMap.get(e.from + '→' + e.to + '|' + (e.label || ''))
    if (wp && wp.length) {
      e.points = routeWithWaypoints(anchorPoint(a, dirFromVector(b.x - a.x, b.y - a.y)), anchorPoint(b, dirFromVector(a.x - b.x, a.y - b.y)), wp)
      return
    }
    e.points = routeEdgePoints(a, b, lay.nodes, offsets.get(e) || 0)
  })
  return lay
}
