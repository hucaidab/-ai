// ============================================================
// editor-core.mjs — 画布编辑器交互层（浏览器 ESM，架构级）
// 单一数据源：req.json（内存对象）→ 复用核心管线渲染 → 编辑写回 → 保存
// 依赖：/lib/ 白名单模块（parse-flow/layout-grid/render-svg/req-util）
// 能力：视口缩放平移 / 节点拖拽(网格吸附+边随动) / 框选 / 双击改文字
//       增删节点 / 属性面板(形状/颜色/文本) / 撤销重做(快照栈)
//       主题切换 / 保存验收 / 导出 PNG/PDF
// 注：锚点连边（拖出新连线）为 backlog 项，尚未实现
// ============================================================
import { parseFlow } from './parse-flow.mjs'
import { layout, rerouteEdges, routeEdgePoints, routeWithWaypoints, edgeOffsets } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'
import { reqToMermaid } from './req-util.mjs'

// ---------- 状态 ----------
export const S = {
  file: '',
  req: null,
  theme: 'github-light',
  selected: null,       // 选中的节点 id 或边 index
  scale: 1,
  history: [],          // 快照栈
  historyIdx: -1,
  dirty: false,
}

const GRID = 8            // 网格吸附步长
const MAX_HISTORY = 50    // 撤销栈上限
const snap = v => Math.round(v / GRID) * GRID

// HTML 转义四件套（& < > "）——面板/输出注入必须全量转义，只转引号是 XSS 陷阱（案例8）
export const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

let _root = null, _svgHost = null

// ---------- 快照 / 撤销重做 ----------
function pushHistory() {
  S.history = S.history.slice(0, S.historyIdx + 1)
  S.history.push(JSON.stringify(S.req))
  if (S.history.length > MAX_HISTORY) S.history.shift()
  S.historyIdx = S.history.length - 1
}
export function undo() {
  if (S.historyIdx <= 0) return
  S.historyIdx--
  S.req = JSON.parse(S.history[S.historyIdx])
  S.dirty = true
  _reselect()
  render()
}
export function redo() {
  if (S.historyIdx >= S.history.length - 1) return
  S.historyIdx++
  S.req = JSON.parse(S.history[S.historyIdx])
  S.dirty = true
  _reselect()
  render()
}
// undo/redo 替换 req 后，selected 可能失效（节点被删/边索引错位）——按标识重查
function _reselect() {
  if (!S.selected) return
  if (S.selected.kind === 'node') {
    if (!S.req.nodes.some(n => n.id === S.selected.id)) S.selected = null
  } else if (S.selected.key) {
    const idx = S.req.edges.findIndex(r => (r.from + '→' + r.to + '|' + (r.label || '')) === S.selected.key)
    S.selected = idx >= 0 ? { kind: 'edge', idx, key: S.selected.key } : null
  }
}

// ---------- 渲染（复用核心管线：req → mmd → parse → layout → svg） ----------
export function render() {
  const src = reqToMermaid(S.req)
  const graph = parseFlow(src)
  const lay = layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, 'auto')
  // 编辑器自动布局结果固化 pos（首次打开），之后 pos 由拖拽维护
  if (S._firstLayout) {
    lay.nodes.forEach(n => {
      const rn = S.req.nodes.find(x => x.id === n.id)
      if (rn) rn.pos = { x: n.x, y: n.y }
    })
    S._firstLayout = false
  }
  // 应用手动位置（pos）：拖动后的位置必须渲染生效（编辑器/CLI/保存三路一致；
  // 漏这一步 = 松手 render 重建时节点回弹到自动布局位置 = 视觉乱飘根因）
  lay.nodes.forEach(n => {
    const rn = S.req.nodes.find(x => x.id === n.id)
    if (rn && rn.pos) n.pos = rn.pos
  })
  // pos 覆盖后重算边路由（否则节点在 pos、边连旧位置 = 视觉断线）
  rerouteEdges(lay, S.req.edges)
  const svg = renderSVG(lay, { classDefs: graph.classDefs, title: S.req.title || '', theme: S.theme })
  // 交互标记（data-id/data-edge/data-eidx）已由 render-svg 渲染层直接输出，
  // 顺序天然与 DOM 一致——消除注入顺序依赖（案例3）；这里只做选中高亮
  let doc = svg.replace(/<svg /, '<svg id="cv" ')
  const out = _svgHost
  out.innerHTML = doc
  // 节点选中高亮
  if (S.selected && S.selected.kind === 'node') {
    const g = out.querySelector('g[data-id="' + S.selected.id + '"]')
    if (g) g.setAttribute('data-sel', '1')
  }
  // 记录节点真实尺寸（框选命中检测用）
  S._nodeSize = {}
  lay.nodes.forEach(n => { S._nodeSize[n.id] = { w: n.w, h: n.h } })
  // 边 DOM 序 → req.edges 索引映射（键含 label，同 from→to 多边不串位）
  S._edgeMap = lay.edges.map(e => S.req.edges.findIndex(r => r.from === e.from && r.to === e.to && (r.label || '') === (e.label || '')))
  // 边命中层：所有边常驻透明粗线（12px 命中区），未选中也能轻松点选/双击（选中事件灵敏度）
  out.querySelectorAll('path[data-edge]').forEach(p => {
    const ei = p.getAttribute('data-eidx')
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    hit.setAttribute('d', p.getAttribute('d'))
    hit.setAttribute('class', 'edge-hit')
    hit.setAttribute('data-eidx', ei)
    p.parentNode.appendChild(hit)
  })
  // 边选中高亮 + 航点手柄（命中层已常驻，不再重复创建）
  if (S.selected && S.selected.kind === 'edge') {
    const ei = S._edgeMap.indexOf(S.selected.idx)
    if (ei >= 0) {
      const p = out.querySelector('path[data-eidx="' + ei + '"]')
      if (p) {
        p.setAttribute('data-sel', '1')
        _renderHandles(out, ei, p)
      }
    }
  }
  bindInteractions()
  _updateStatus()
}

// ---------- 航点手柄（draw.io waypoints 交互） ----------
// 解析 path d 折点（M/L 格式）
function parsePathPts(d) {
  const m = d.match(/M\s+(-?[\d.]+)\s+(-?[\d.]+)/)
  if (!m) return []
  const pts = [[+m[1], +m[2]]]
  const re = /L\s+(-?[\d.]+)\s+(-?[\d.]+)/g
  let mm
  while ((mm = re.exec(d))) pts.push([+mm[1], +mm[2]])
  return pts
}
const pathFromPts = pts => 'M ' + pts.map(p => p[0] + ' ' + p[1]).join(' L ')

// 选中边：渲染折点手柄（蓝方块，端点灰）——命中层已由 render() 常驻
function _renderHandles(out, ei, pathEl) {
  const cv = out.querySelector('svg')
  const pts = parsePathPts(pathEl.getAttribute('d'))
  const NS = 'http://www.w3.org/2000/svg'
  // 手柄（每个折点一个小方块）
  pts.forEach((pt, i) => {
    const h = document.createElementNS(NS, 'rect')
    h.setAttribute('x', pt[0] - 5); h.setAttribute('y', pt[1] - 5)
    h.setAttribute('width', 10); h.setAttribute('height', 10)
    h.setAttribute('rx', 2)
    h.setAttribute('class', 'wp-handle')
    h.setAttribute('data-wp-i', i)
    h.setAttribute('fill', (i === 0 || i === pts.length - 1) ? '#6e7781' : '#0969da') // 端点灰（不可拖）
    cv.appendChild(h)
  })
}

// 点到线段的最近点
function nearestOnSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0
  return [x0 + t * dx, y0 + t * dy]
}

// 双击边路径 → 在最近线段中点加航点（接管 wp）
function _onEdgeDbl(e, hitEl) {
  const ei = parseInt(hitEl.getAttribute('data-eidx') || '0', 10)
  const realIdx = S._edgeMap[ei]
  const edge = S.req.edges[realIdx]
  if (!edge) return
  const cvRect = document.getElementById('cv').getBoundingClientRect()
  const wx = (e.clientX - cvRect.left) / S.scale
  const wy = (e.clientY - cvRect.top) / S.scale
  const pts = parsePathPts(hitEl.getAttribute('d'))
  if (pts.length < 2) return
  // 找最近线段 + 最近点
  let bestD = Infinity, segIdx = 0, ins = null
  for (let i = 0; i < pts.length - 1; i++) {
    const q = nearestOnSeg(wx, wy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    const d = (q[0] - wx) ** 2 + (q[1] - wy) ** 2
    if (d < bestD) { bestD = d; segIdx = i; ins = q }
  }
  if (!ins) return
  // 无 wp 时先接管当前中间折点（手动控制路径）
  if (!edge.wp || !edge.wp.length) edge.wp = pts.slice(1, -1).map(p => [p[0], p[1]])
  // 插入位置：段 segIdx 位于折点 segIdx 与 segIdx+1 之间 → wp 下标 segIdx-1 处（端点段对应 0 边界）
  const at = Math.max(0, Math.min(edge.wp.length, segIdx - 1))
  edge.wp.splice(at, 0, [Math.round(ins[0]), Math.round(ins[1])])
  S.dirty = true
  pushHistory()
  render()
}

// 双击手柄 → 删除该航点
function _onHandleDbl(e, handle) {
  e.stopPropagation()
  const ei = parseInt(handle.getAttribute('data-wp-i'), 10)
  const edge = S.req.edges[S.selected && S.selected.kind === 'edge' ? S.selected.idx : -1]
  if (!edge) return
  const domIdx = S._edgeMap.indexOf(S.selected.idx)
  const pathEl = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
  if (!pathEl) return
  const pts = parsePathPts(pathEl.getAttribute('d'))
  if (ei === 0 || ei === pts.length - 1 || !edge.wp || !edge.wp.length) return
  const idxInWp = ei - 1
  if (edge.wp[idxInWp]) {
    edge.wp.splice(idxInWp, 1)
    S.dirty = true
    pushHistory()
    render()
  }
}

// 拖手柄 → 移动航点（零重建实时重绘；端点不可拖）
function _onHandleDown(e, handle) {
  e.stopPropagation()
  const ei = parseInt(handle.getAttribute('data-wp-i'), 10)
  const edge = S.req.edges[S.selected && S.selected.kind === 'edge' ? S.selected.idx : -1]
  if (!edge) return
  const domIdx = S._edgeMap.indexOf(S.selected.idx)
  const pathEl = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
  if (!pathEl) return
  const pts = parsePathPts(pathEl.getAttribute('d'))
  if (ei === 0 || ei === pts.length - 1) return // 端点（锚点）不可拖
  const p1 = pts[0], p2 = pts[pts.length - 1]
  const cvRect = document.getElementById('cv').getBoundingClientRect()
  let moved = false // 无位移（单击）不重建——否则双击删除的第二次 click 落空
  const move = ev => {
    // 首次移动时接管当前中间折点为航点（单击不改数据）
    if (!edge.wp || !edge.wp.length) edge.wp = pts.slice(1, -1).map(p => [p[0], p[1]])
    const idxInWp = ei - 1
    if (!edge.wp[idxInWp]) return
    const wx = (ev.clientX - cvRect.left) / S.scale
    const wy = (ev.clientY - cvRect.top) / S.scale
    edge.wp[idxInWp] = [snap(wx), snap(wy)]
    const np = routeWithWaypoints({ x: p1[0], y: p1[1] }, { x: p2[0], y: p2[1] }, edge.wp)
    pathEl.setAttribute('d', pathFromPts(np))
    handle.setAttribute('x', edge.wp[idxInWp][0] - 5)
    handle.setAttribute('y', edge.wp[idxInWp][1] - 5)
    moved = true
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (moved) {
      S.dirty = true
      pushHistory()
      render() // 全量重建（手柄/命中层统一刷新）
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 交互绑定（事件委托：svg 根一次绑定，不受 innerHTML 重建影响） ----------
export function bindInteractions() {
  const cv = document.getElementById('cv')
  if (!cv || cv._bound) return
  cv._bound = true
  // 节点：pointerdown 拖动 / dblclick 改文字（通过 closest 定位，点文字/形状都命中）
  cv.addEventListener('pointerdown', e => {
    const h = e.target.closest ? e.target.closest('.wp-handle') : null
    if (h) { _onHandleDown(e, h); return }
    const g = e.target.closest ? e.target.closest('g[data-id]') : null
    if (g) { _onNodeDown(e, g); return }
    // 边：优先命中层（12px 命中区，选中灵敏度），其次原细 path
    const p = e.target.closest ? (e.target.closest('path.edge-hit') || e.target.closest('path[data-edge]')) : null
    if (p) { e.stopPropagation(); _onEdgeDown(e, p) }
  })
  cv.addEventListener('dblclick', e => {
    const h = e.target.closest ? e.target.closest('.wp-handle') : null
    if (h) { _onHandleDbl(e, h); return }
    const g = e.target.closest ? e.target.closest('g[data-id]') : null
    if (g) { _onDblClick(e, g); return }
    // 边路径双击 → 加航点（命中层 .edge-hit 或原 path）
    const hit = e.target.closest ? (e.target.closest('path.edge-hit') || e.target.closest('path[data-edge]')) : null
    if (hit) { e.stopPropagation(); _onEdgeDbl(e, hit) }
  })
}

function _onNodeDown(e, g) {
  e.stopPropagation()
  const id = g.getAttribute('data-id')
  const node = S.req.nodes.find(n => n.id === id)
  if (!node) return
  // 轻量选择：直接操作 DOM 高亮（不重建，保持 g 引用有效供拖拽）
  S.selected = { kind: 'node', id }
  document.querySelectorAll('#cv g[data-sel]').forEach(x => x.removeAttribute('data-sel'))
  g.setAttribute('data-sel', '1')
  _updatePanel()
  const startX = e.clientX, startY = e.clientY
  const origX = node.pos ? node.pos.x : 0, origY = node.pos ? node.pos.y : 0
  let moved = false // 无位移不入撤销栈（避免空快照污染 undo 历史）
  // 拖动中：直接 transform 移动节点（零重建，绝对跟手；边实时重路由跟随）
  const move = ev => {
    const dx = snap((ev.clientX - startX) / S.scale), dy = snap((ev.clientY - startY) / S.scale)
    node.pos = { x: origX + dx, y: origY + dy }
    g.setAttribute('transform', 'translate(' + node.pos.x + ',' + node.pos.y + ')')
    _rerouteEdges(id) // 相连边实时跟随（松手后 render 用正式布局重路由）
    moved = true
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (moved) { S.dirty = true; pushHistory() }
    render() // 提交：边重路由 + 高亮统一（拖动中只移了节点本身）
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function _onDblClick(e, g) {
  e.stopPropagation()
  const id = g.getAttribute('data-id')
  const node = S.req.nodes.find(n => n.id === id)
  if (!node) return
  const rect = g.getBoundingClientRect()
  const input = document.createElement('input')
  input.value = node.action || ''
  input.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;font-size:13px;border:2px solid #0969da;border-radius:6px;padding:4px 8px;z-index:99;box-sizing:border-box`
  document.body.appendChild(input)
  input.focus(); input.select()
  // cancelled 标志隔离事件链副作用：input.remove() 会触发 blur，若 blur 直接 commit，
  // Escape 取消的修改会被保存（案例9）——取消路径必须与提交路径隔离
  let cancelled = false
  const commit = () => {
    const v = input.value.trim()
    if (!cancelled && v && v !== node.action) { node.action = v; S.dirty = true; pushHistory(); render() }
    input.remove()
  }
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') commit()
    if (ev.key === 'Escape') { cancelled = true; input.remove() }
  })
  input.addEventListener('blur', () => { if (!cancelled) commit() })
}

// 拖动中实时重路由相连边（与 layout-grid 的 routeEdgePoints 同一算法——
// 拖动中/松手 render/服务端保存三路路由一致；松手后 render 正式重路由）
function _rerouteEdges(dragId) {
  const nodeObj = nid => {
    const n = S.req.nodes.find(x => x.id === nid)
    if (!n) return null
    const sz = (S._nodeSize && S._nodeSize[nid]) || { w: 180, h: 54 }
    const p = n.pos || { x: 0, y: 0 }
    return { id: nid, x: p.x, y: p.y, w: sz.w, h: sz.h, pos: p }
  }
  // 全部节点（含 id，供避障按 id 排除端点）
  const allNodes = S.req.nodes.map(n => nodeObj(n.id)).filter(Boolean)
  // 同对边平行偏移（拖动中双向/多边不重叠）
  const offsets = edgeOffsets(S.req.edges)
  S.req.edges.forEach((e, i) => {
    if (e.from !== dragId && e.to !== dragId) return
    const domIdx = S._edgeMap.indexOf(i)
    if (domIdx < 0) return
    const p = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
    if (!p) return
    const a = allNodes.find(n => n.id === e.from), b = allNodes.find(n => n.id === e.to)
    if (!a || !b) return
    const pts = routeEdgePoints(a, b, allNodes, offsets.get(e) || 0)
    p.setAttribute('d', 'M ' + pts.map(pt => pt[0] + ' ' + pt[1]).join(' L '))
  })
}

function _selectEdge(p) {
  const eidx = parseInt(p.getAttribute('data-eidx') || '0', 10)
  // DOM 顺序（lay.edges）→ req.edges 索引映射，避免布局重排错位
  const realIdx = S._edgeMap && S._edgeMap[eidx] !== undefined && S._edgeMap[eidx] >= 0 ? S._edgeMap[eidx] : eidx
  const edge = S.req.edges[realIdx]
  if (!edge) return
  // 存 from→to+label 标识：undo/redo 替换 req 后按标识重查（#5）
  S.selected = { kind: 'edge', idx: realIdx, key: edge.from + '→' + edge.to + '|' + (edge.label || '') }
  render()
  _updatePanel()
}

function _onCanvasDown(e) {
  // 空白处：框选
  const cv = document.getElementById('cv')
  const rect = cv.getBoundingClientRect()
  const x0 = e.clientX, y0 = e.clientY
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;border:1px dashed #0969da;background:rgba(9,105,218,.08);z-index:50;pointer-events:none'
  document.body.appendChild(box)
  const move = ev => {
    box.style.left = Math.min(x0, ev.clientX) + 'px'
    box.style.top = Math.min(y0, ev.clientY) + 'px'
    box.style.width = Math.abs(ev.clientX - x0) + 'px'
    box.style.height = Math.abs(ev.clientY - y0) + 'px'
  }
  const up = ev => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    box.remove()
    // 命中检测（世界坐标 AABB）
    const wx = (Math.min(x0, ev.clientX) - rect.left) / S.scale
    const wy = (Math.min(y0, ev.clientY) - rect.top) / S.scale
    const ww = Math.abs(ev.clientX - x0) / S.scale
    const wh = Math.abs(ev.clientY - y0) / S.scale
    // 命中检测（世界坐标 AABB）；当前为单选语义：框选多个时选中视觉最上层（数组末尾）的节点
    const hit = S.req.nodes.filter(n => {
      const p = n.pos || { x: 0, y: 0 }
      const sz = (S._nodeSize && S._nodeSize[n.id]) || { w: 180, h: 54 }
      return p.x < wx + ww && p.x + sz.w > wx && p.y < wy + wh && p.y + sz.h > wy
    })
    if (hit.length) { selectNode(hit[hit.length - 1].id) }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 选择与属性 ----------
// 按下边本体：选中 + 拖边 = 整条边平移（端点钉在节点锚点，中间折点整体移动；
// 对齐 draw.io 拖线行为，避免"按下边不动、像穿透到背景"）
function _onEdgeDown(e, p) {
  e.stopPropagation()
  const eidx = parseInt(p.getAttribute('data-eidx') || '0', 10)
  const realIdx = S._edgeMap && S._edgeMap[eidx] >= 0 ? S._edgeMap[eidx] : eidx
  const edge = S.req.edges[realIdx]
  if (!edge) return
  // 轻量选中（不 render，避免重建打断拖拽起点）
  S.selected = { kind: 'edge', idx: realIdx, key: edge.from + '→' + edge.to + '|' + (edge.label || '') }
  _updatePanel()
  const domIdx = eidx
  const cvRect = document.getElementById('cv').getBoundingClientRect()
  const startX = e.clientX, startY = e.clientY
  let moved = false, origPts = null, origWp = null
  // origPts: 原始路径端点（节点锚点，拖拽中保持不变）
  // origWp: 初始航点快照——move 里用"快照 + 总位移"而非"当前值 + 总位移"（避免二次累积漂移）
  const move = ev => {
    if (!moved) {
      // 首次移动：给当前 DOM 边加高亮，并记录原始折点/端点/航点快照
      const pathEl = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
      if (!pathEl) return
      pathEl.setAttribute('data-sel', '1')
      const pts = parsePathPts(pathEl.getAttribute('d'))
      origPts = { p1: pts[0], p2: pts[pts.length - 1] }
      // 无 wp 先接管当前中间折点（拖动即固化形状，保存后保持）
      if (!edge.wp || !edge.wp.length) edge.wp = pts.slice(1, -1).map(p => [p[0], p[1]])
      origWp = edge.wp.map(w => [w[0], w[1]]) // 初始快照
      moved = true
    }
    const dx = (ev.clientX - startX) / S.scale
    const dy = (ev.clientY - startY) / S.scale
    // 平移 wp：快照 + 总位移（端点锚点不动）
    edge.wp.forEach((w, i) => { edge.wp[i] = [origWp[i][0] + dx, origWp[i][1] + dy] })
    // 重绘路径（端点保持原始锚点，中间过平移后的 wp）
    const pathEl = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
    if (!pathEl) return
    const np = routeWithWaypoints({ x: origPts.p1[0], y: origPts.p1[1] }, { x: origPts.p2[0], y: origPts.p2[1] }, edge.wp)
    pathEl.setAttribute('d', pathFromPts(np))
    // 命中层同步
    const hitEl = _svgHost.querySelector('path.edge-hit[data-eidx="' + domIdx + '"]')
    if (hitEl) hitEl.setAttribute('d', pathFromPts(np))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (moved) {
      S.dirty = true
      pushHistory()
      render() // 全量重建（手柄/命中层统一刷新）
    } else {
      // 未拖动（单击选中）：轻量高亮 + 只加手柄，**不重建整图**——
      // 重建会替换 DOM 导致双击第二击 target 不同，双击加航点失效
      const pathEl = _svgHost.querySelector('path[data-eidx="' + domIdx + '"]')
      if (pathEl) {
        pathEl.setAttribute('data-sel', '1')
        _renderHandles(_svgHost, domIdx, pathEl)
      }
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 选择与属性 ----------
export function selectNode(id) {
  S.selected = { kind: 'node', id }
  render()
  _updatePanel()
}

// ---------- 属性面板 ----------
function _updatePanel() {
  const panel = document.getElementById('propPanel')
  if (!panel) return
  if (!S.selected) { panel.innerHTML = '<div class="ph">未选中任何元素<br><span>单击节点/边选中，双击节点改文字</span></div>'; return }
  if (S.selected.kind === 'node') {
    const n = S.req.nodes.find(x => x.id === S.selected.id)
    if (!n) return
    const shapes = ['rect', 'diamond', 'stadium', 'cylinder', 'subroutine', 'circle']
    panel.innerHTML = `
      <div class="pt">节点属性</div>
      <label>文本</label><input id="pText" value="${escHtml(n.action)}">
      <label>形状</label><select id="pShape">${shapes.map(s => `<option ${s === n.shape ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>泳道(部门)</label><input id="pDept" value="${escHtml(n.dept)}">
      <label>角色</label><input id="pRole" value="${escHtml(n.role)}">
      <label>自定义填充色</label><input type="color" id="pFill" value="${escHtml(n.fill)}">
      <button onclick="window.__editor.applyProps()">应用</button>`
    document.getElementById('pText').oninput = e => { n.action = e.target.value; S.dirty = true }
    document.getElementById('pShape').onchange = e => { n.shape = e.target.value; S.dirty = true }
    document.getElementById('pDept').oninput = e => { n.dept = e.target.value; S.dirty = true }
    document.getElementById('pRole').oninput = e => { n.role = e.target.value; S.dirty = true }
    document.getElementById('pFill').oninput = e => { n.fill = e.target.value; S.dirty = true }
  } else if (S.selected.kind === 'edge') {
    const e = S.req.edges[S.selected.idx]
    if (!e) return
    panel.innerHTML = `
      <div class="pt">连线属性</div>
      <label>标签</label><input id="eLabel" value="${escHtml(e.label)}">
      <label>线型</label><select id="eType"><option ${!e.reverse ? 'selected' : ''}>实线</option><option ${e.reverse ? 'selected' : ''}>虚线(逆向)</option></select>
      <button onclick="window.__editor.applyEdge()">应用</button>
      <button class="danger" onclick="window.__editor.delEdge()">删除此连线</button>`
    document.getElementById('eLabel').oninput = ev => { e.label = ev.target.value; S.dirty = true }
    document.getElementById('eType').onchange = ev => { e.reverse = ev.target.value === '虚线(逆向)'; S.dirty = true }
  }
}

// 属性面板应用（导出函数——模块命名空间对象冻结，不能动态加属性）
export function applyProps() {
  if (!S.selected || S.selected.kind !== 'node') return
  const n = S.req.nodes.find(x => x.id === S.selected.id)
  if (!n) return
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : null }
  const text = v('pText'), shape = v('pShape'), dept = v('pDept'), role = v('pRole'), fill = v('pFill')
  if (text !== null && text !== n.action) n.action = text
  if (shape && shape !== n.shape) n.shape = shape
  if (dept !== null && dept !== n.dept) n.dept = dept
  if (role !== null && role !== n.role) n.role = role
  if (fill && fill !== n.fill) n.fill = fill
  S.dirty = true
  pushHistory()
  render()
}
export function applyEdge() {
  if (!S.selected || S.selected.kind !== 'edge') return
  const e = S.req.edges[S.selected.idx]
  if (!e) return
  const l = document.getElementById('eLabel'), t = document.getElementById('eType')
  if (l) e.label = l.value.trim()
  if (t) e.reverse = t.value === '虚线(逆向)'
  S.dirty = true
  pushHistory()
  render()
}
export function delEdge() {
  if (!S.selected || S.selected.kind !== 'edge') return
  S.req.edges.splice(S.selected.idx, 1)
  S.selected = null
  S.dirty = true
  pushHistory()
  render()
}
export function setTheme(t) {
  S.theme = t || 'github-light'
  render()
}

// ---------- 增删节点 ----------
export function addNode() {
  const id = 'N' + (S.req.nodes.length + 1) + '_' + Date.now().toString(36).slice(-3)
  S.req.nodes.push({ id, dept: '其他', role: '新增', action: '新节点', shape: 'rect' })
  S.dirty = true
  pushHistory()
  render()
}
export function delSelected() {
  if (!S.selected) return
  if (S.selected.kind === 'node') {
    const id = S.selected.id
    S.req.nodes = S.req.nodes.filter(n => n.id !== id)
    S.req.edges = S.req.edges.filter(e => e.from !== id && e.to !== id)
  } else if (S.selected.kind === 'edge') {
    S.req.edges.splice(S.selected.idx, 1)
  }
  S.selected = null
  S.dirty = true
  pushHistory()
  render()
}

// ---------- 保存（写回 req.json + 重新验收） ----------
export async function save() {
  const btn = document.getElementById('btnSave')
  if (btn) { btn.disabled = true; btn.textContent = '保存中…' }
  try {
    const r = await fetch('/api/editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('editor_token') ? { 'x-editor-token': localStorage.getItem('editor_token') } : {}) },
      body: JSON.stringify({ file: S.file, req: S.req, theme: S.theme }),
    })
    const d = await r.json()
    const st = document.getElementById('saveStatus')
    if (d.ok) {
      S.dirty = false
      st.textContent = d.pass ? `✅ 已保存 · 验收通过（${d.summary}）` : `⚠️ 已保存 · 验收 ${d.summary}`
      st.className = d.pass ? 'ok' : 'warn'
      if (d.fixed && d.fixLog && d.fixLog.length) st.textContent += ' · 自动修复：' + d.fixLog.join('、')
    } else {
      st.textContent = '❌ ' + (d.error || '保存失败')
      st.className = 'err'
    }
    return d // 供导出使用（svgFile 由服务端回传，消除前端文件名推导假设）
  } catch (e) {
    const st = document.getElementById('saveStatus')
    st.textContent = '❌ 保存失败：' + e.message
    st.className = 'err'
  }
  if (btn) { btn.disabled = false; btn.textContent = '💾 保存' }
}

// ---------- 导出（保存后调现有接口；svg 文件名由服务端回传，不自行推导） ----------
export async function exportPng() { const d = await save(); const f = (d && d.svgFile) || S.file.replace(/\.req\.json$/, '.svg'); window.open('/api/png?file=' + encodeURIComponent(f)) }
export async function exportPdf() { const d = await save(); const f = (d && d.svgFile) || S.file.replace(/\.req\.json$/, '.svg'); window.open('/api/pdf?file=' + encodeURIComponent(f)) }

// ---------- 状态栏 ----------
function _updateStatus() {
  const st = document.getElementById('saveStatus')
  if (st && !S.dirty && st.textContent.startsWith('✅')) return
  const el = document.getElementById('zoomStatus')
  if (el) el.textContent = Math.round(S.scale * 100) + '%'
}

// ---------- 初始化 ----------
export async function init(file, reqData) {
  S.file = file
  if (reqData) {
    S.req = reqData
  } else {
    const r = await fetch('/file/' + encodeURIComponent(file))
    if (!r.ok) { alert('加载失败：' + file); return }
    S.req = await r.json()
  }
  S._firstLayout = true
  const host = document.getElementById('svgHost')
  _svgHost = host
  host.style.transform = 'scale(' + S.scale + ')'
  host.style.transformOrigin = '0 0'
  render()
  bindInteractions()
  pushHistory() // 初始快照（撤销回到初始态）
  // 画布空白事件
  document.getElementById('canvasWrap').addEventListener('pointerdown', e => {
    if (e.target === host || e.target.id === 'canvasWrap') _onCanvasDown(e)
  })
  // 滚轮缩放
  document.getElementById('canvasWrap').addEventListener('wheel', e => {
    e.preventDefault()
    S.scale = Math.min(2.5, Math.max(0.3, S.scale * (e.deltaY < 0 ? 1.1 : 0.9)))
    host.style.transform = 'scale(' + S.scale + ')'
    _updateStatus()
  }, { passive: false })
  // 键盘
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
    else if (e.key === 'Delete') delSelected() // 只保留 Delete；Backspace 有浏览器导航/误删风险
  })
}
