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
import { layout, rerouteEdges, routeEdgePoints, routeWithWaypoints, edgeOffsets, anchorPoint } from './layout-grid.mjs'
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
  // 节点选中高亮 + 连接锚点
  if (S.selected && S.selected.kind === 'node') {
    const g = out.querySelector('g[data-id="' + S.selected.id + '"]')
    if (g) {
      g.setAttribute('data-sel', '1')
      _renderPorts(g)
    }
  }
  // 节点备注标签（📝，有 note 常驻；点击查看）
  const NS = 'http://www.w3.org/2000/svg'
  S.req.nodes.forEach(n => {
    if (!n.note) return
    const sz = S._nodeSize[n.id] || { w: 180, h: 50 }
    const p = n.pos || { x: 0, y: 0 }
    const badge = document.createElementNS(NS, 'text')
    badge.setAttribute('x', p.x + sz.w - 6)
    badge.setAttribute('y', p.y + 4)
    badge.setAttribute('font-size', 13)
    badge.setAttribute('cursor', 'pointer')
    badge.setAttribute('class', 'note-badge')
    badge.setAttribute('data-note-id', n.id)
    badge.textContent = '📝'
    out.querySelector('svg').appendChild(badge)
  })
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
// 手柄恒定屏幕尺寸（10/S.scale world 单位）：缩放后手柄视觉不变，否则缩小后难以点击（质检抓出）
function _renderHandles(out, ei, pathEl) {
  const cv = out.querySelector('svg')
  const pts = parsePathPts(pathEl.getAttribute('d'))
  const NS = 'http://www.w3.org/2000/svg'
  const hs = 10 / S.scale // 视觉恒定 10px
  // 手柄（每个折点一个小方块）
  pts.forEach((pt, i) => {
    const h = document.createElementNS(NS, 'rect')
    h.setAttribute('x', pt[0] - hs / 2); h.setAttribute('y', pt[1] - hs / 2)
    h.setAttribute('width', hs); h.setAttribute('height', hs)
    h.setAttribute('rx', 2 / S.scale)
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
  // 双击线 = 编辑线标签（备注）；浮动 input（同节点双击改字模式）。
  // 加航点改由"拖边接管折点 + 拖手柄"承担，避免双击语义冲突。
  const input = document.createElement('input')
  input.value = edge.label || ''
  input.placeholder = '输入连线备注（如：通过 / 驳回）'
  input.style.cssText = `position:fixed;left:${e.clientX + 8}px;top:${e.clientY + 8}px;width:200px;font-size:13px;border:2px solid #0969da;border-radius:6px;padding:4px 8px;z-index:99;box-sizing:border-box`
  document.body.appendChild(input)
  input.focus(); input.select()
  let cancelled = false, committed = false // committed 防重入：remove→blur→commit 二次调用直接返回
  const commit = () => {
    if (committed) return
    committed = true
    const v = input.value.trim()
    if (!cancelled && v !== (edge.label || '')) { edge.label = v; S.dirty = true; pushHistory(); render() }
    if (input.isConnected) input.remove()
  }
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') commit()
    if (ev.key === 'Escape') { cancelled = true; input.remove() }
  })
  input.addEventListener('blur', () => { if (!cancelled) commit() })
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
  e.preventDefault() // 阻断浏览器默认文本选择/拖拽
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
    // 连接锚点（拖线建边）优先
    const port = e.target.closest ? e.target.closest('.node-port') : null
    if (port) { _onPortDown(e, port); return }
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
    // 边路径双击 → 编辑线标签备注（命中层 .edge-hit 或原 path）
    const hit = e.target.closest ? (e.target.closest('path.edge-hit') || e.target.closest('path[data-edge]')) : null
    if (hit) { e.stopPropagation(); _onEdgeDbl(e, hit) }
  })
  // 节点右键 → 备注编辑
  cv.addEventListener('contextmenu', e => {
    const g = e.target.closest ? e.target.closest('g[data-id]') : null
    if (g) { e.preventDefault(); _onNodeCtx(e, g) }
  })
  // 备注标签点击 → 查看备注
  cv.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('.note-badge') : null
    if (b) { e.stopPropagation(); _showNote(b.getAttribute('data-note-id')) }
  })
}

// ---------- 节点备注（右键编辑多行 + 📝 标签查看） ----------
function _onNodeCtx(e, g) {
  e.preventDefault()
  const id = g.getAttribute('data-id')
  const n = S.req.nodes.find(x => x.id === id)
  if (!n) return
  // 浮层备注编辑器（多行 textarea）
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);background:#fff;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.22);padding:16px;z-index:200;width:340px;font-family:inherit'
  wrap.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:14px">📝 节点备注（${escHtml(n.action || n.id)}）</div>
    <textarea id="noteInput" rows="5" style="width:100%;box-sizing:border-box;border:1px solid #d0d7de;border-radius:6px;padding:8px;font-size:13px;resize:vertical" placeholder="输入备注（支持多行）…">${escHtml(n.note || '')}</textarea>
    <div style="margin-top:10px;text-align:right">
      <button id="noteCancel" style="background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:6px 16px;margin-right:8px;cursor:pointer">取消</button>
      <button id="noteSave" style="background:#0969da;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer">保存</button>
    </div>`
  document.body.appendChild(wrap)
  const ta = document.getElementById('noteInput')
  ta.focus()
  const save = () => {
    const v = ta.value.trim()
    if (v) n.note = v; else delete n.note
    S.dirty = true
    pushHistory()
    render()
    wrap.remove()
  }
  document.getElementById('noteCancel').onclick = () => wrap.remove()
  document.getElementById('noteSave').onclick = save
  ta.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') save() })
}

// 查看备注弹窗
function _showNote(id) {
  const n = S.req.nodes.find(x => x.id === id)
  if (!n || !n.note) return
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);background:#fff;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.22);padding:16px;z-index:200;width:340px;max-width:80vw;font-family:inherit'
  wrap.innerHTML = `<div style="font-weight:700;margin-bottom:8px;font-size:14px">📝 ${escHtml(n.action || n.id)} 的备注</div>
    <div style="font-size:13px;white-space:pre-wrap;color:#24292f;line-height:1.6;max-height:60vh;overflow:auto">${escHtml(n.note)}</div>
    <div style="margin-top:12px;text-align:right"><button id="noteClose" style="background:#0969da;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer">关闭</button></div>`
  document.body.appendChild(wrap)
  document.getElementById('noteClose').onclick = () => wrap.remove()
}

function _onNodeDown(e, g) {
  e.stopPropagation()
  e.preventDefault() // 阻断浏览器默认文本选择/拖拽
  const id = g.getAttribute('data-id')
  const node = S.req.nodes.find(n => n.id === id)
  if (!node) return
  // 轻量选择：直接操作 DOM 高亮（不重建，保持 g 引用有效供拖拽）
  S.selected = { kind: 'node', id }
  document.querySelectorAll('#cv g[data-sel]').forEach(x => x.removeAttribute('data-sel'))
  g.setAttribute('data-sel', '1')
  // 锚点延迟 250ms 渲染：立即渲染会修改 SVG DOM → 浏览器重置 dblclick 判定，
  // 双击的第二次 click hit-test 变化 → dblclick 不生成 → 双击改字失效（质检抓出）
  clearTimeout(S._portTimer)
  S._portTimer = setTimeout(() => {
    if (!(S.selected && S.selected.kind === 'node' && S.selected.id === id)) return
    const curG = document.querySelector('g[data-id="' + id + '"]')
    if (curG) _renderPorts(curG)
  }, 250)
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
  const up = ev => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    if (moved) { S.dirty = true; pushHistory(); render() } // 拖动了才提交重渲染
    // 未拖动（单击/双击）不 render：render 全量重建 DOM → mouseup hit-test 失效 →
    // click 事件不合成 → dblclick 不生成 → 双击改字失效（质检抓出；与双击线同机制）
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
  let cancelled = false, committed = false // committed 防重入：remove→blur→commit 二次调用直接返回
  const commit = () => {
    if (committed) return
    committed = true
    const v = input.value.trim()
    if (!cancelled && v && v !== node.action) { node.action = v; S.dirty = true; pushHistory(); render() }
    if (input.isConnected) input.remove()
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
  e.preventDefault() // 阻断浏览器默认文本选择/拖拽
  const cv = document.getElementById('cv')
  const rect = cv.getBoundingClientRect()
  const x0 = e.clientX, y0 = e.clientY
  // 点击空白（无位移）→ 取消选中（专业编辑器惯例）；拖拽空白 → 框选
  let moved = false
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;border:1px dashed #0969da;background:rgba(9,105,218,.08);z-index:50;pointer-events:none'
  document.body.appendChild(box)
  const move = ev => {
    if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) moved = true
    box.style.left = Math.min(x0, ev.clientX) + 'px'
    box.style.top = Math.min(y0, ev.clientY) + 'px'
    box.style.width = Math.abs(ev.clientX - x0) + 'px'
    box.style.height = Math.abs(ev.clientY - y0) + 'px'
  }
  const up = ev => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    box.remove()
    if (!moved) {
      // 点击空白：取消选中（清高亮/锚点/手柄；边 path 只移除属性不能删除本体）
      if (S.selected) {
        S.selected = null
        cv.querySelectorAll('g[data-sel]').forEach(x => x.removeAttribute('data-sel'))
        cv.querySelectorAll('path[data-sel]').forEach(x => x.removeAttribute('data-sel'))
        cv.querySelectorAll('.node-port, .wp-handle').forEach(x => x.remove())
        clearTimeout(S._portTimer)
        _updatePanel()
      }
      return
    }
    // 拖拽：框选命中检测（世界坐标 AABB；当前为单选语义：框选多个时选中视觉最上层（数组末尾）的节点）
    const wx = (Math.min(x0, ev.clientX) - rect.left) / S.scale
    const wy = (Math.min(y0, ev.clientY) - rect.top) / S.scale
    const ww = Math.abs(ev.clientX - x0) / S.scale
    const wh = Math.abs(ev.clientY - y0) / S.scale
    const hit = S.req.nodes.filter(n => {
      const p = n.pos || { x: 0, y: 0 }
      const sz = (S._nodeSize && S._nodeSize[n.id]) || { w: 180, h: 54 }
      return p.x < wx + ww && p.x + sz.w > wx && p.y < wy + wh && p.y + sz.h > wy
    })
    if (hit.length) selectNode(hit[hit.length - 1].id)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 锚点连边（draw.io：节点连接点拖到目标节点建边） ----------
const PORT_DIRS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']
// 选中节点渲染 8 方向连接锚点（小圆点，拖到目标节点建边）
function _renderPorts(g) {
  const cv = document.getElementById('cv')
  if (!cv) return
  // 清理旧锚点（切换选中节点时旧锚点残留 → querySelector 取到旧节点锚点 → 建边源错误——质检抓出）
  cv.querySelectorAll('.node-port').forEach(c => c.remove())
  const NS = 'http://www.w3.org/2000/svg'
  const id = g.getAttribute('data-id')
  const n = S.req.nodes.find(x => x.id === id)
  if (!n) return
  const sz = (S._nodeSize && S._nodeSize[id]) || { w: 180, h: 50 }
  const p = n.pos || { x: 0, y: 0 }
  const obj = { id, x: p.x, y: p.y, w: sz.w, h: sz.h, pos: p }
  for (const dir of PORT_DIRS) {
    const a = anchorPoint(obj, dir)
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', a.x); c.setAttribute('cy', a.y)
    c.setAttribute('r', 8 / S.scale) // 恒定屏幕尺寸 8px：锚点易点中（5px 偏小难拖——用户反馈）
    c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#0969da'); c.setAttribute('stroke-width', 2.5 / S.scale)
    c.setAttribute('class', 'node-port'); c.setAttribute('data-node-port', id); c.setAttribute('data-port-dir', dir)
    c.setAttribute('cursor', 'crosshair')
    cv.appendChild(c)
  }
}

// 拖线建边目标提示：在 hover 节点上渲染连接锚点（.target-port，独立于选中锚点 .node-port——
// 不清理源节点锚点，拖线过程中源/目标锚点并存）
function _renderTargetPorts(g) {
  const cv = document.getElementById('cv')
  if (!cv) return
  const NS = 'http://www.w3.org/2000/svg'
  const id = g.getAttribute('data-id')
  const n = S.req.nodes.find(x => x.id === id)
  if (!n) return
  const sz = (S._nodeSize && S._nodeSize[id]) || { w: 180, h: 50 }
  const p = n.pos || { x: 0, y: 0 }
  const obj = { id, x: p.x, y: p.y, w: sz.w, h: sz.h, pos: p }
  for (const dir of PORT_DIRS) {
    const a = anchorPoint(obj, dir)
    const c = document.createElementNS(NS, 'circle')
    c.setAttribute('cx', a.x); c.setAttribute('cy', a.y)
    c.setAttribute('r', 8 / S.scale)
    c.setAttribute('class', 'target-port')
    cv.appendChild(c)
  }
}

// 按下连接锚点 → 拖橡皮筋线到目标节点松手建边（未命中取消）
function _onPortDown(e, port) {
  e.stopPropagation()
  e.preventDefault() // 阻断浏览器默认文本选择/拖拽
  const fromId = port.getAttribute('data-node-port')
  const cv = document.getElementById('cv')
  const cvRect = cv.getBoundingClientRect()
  const NS = 'http://www.w3.org/2000/svg'
  // 橡皮筋预览线
  const band = document.createElementNS(NS, 'path')
  band.setAttribute('stroke', '#0969da'); band.setAttribute('stroke-width', 2)
  band.setAttribute('stroke-dasharray', '6 4'); band.setAttribute('fill', 'none')
  band.setAttribute('class', 'rubber-band')
  cv.appendChild(band)
  const sx = (e.clientX - cvRect.left) / S.scale, sy = (e.clientY - cvRect.top) / S.scale
  band.setAttribute('d', `M ${sx} ${sy} L ${sx} ${sy}`)
  // 目标节点 hover 提示（draw.io：拖线经过的节点高亮 + 显示连接锚点，松手即连接）
  // 世界坐标命中（AABB），与 up 建边同逻辑
  const hoverHit = (wx, wy) => {
    const PAD = 4 / S.scale
    for (const n of S.req.nodes) {
      if (n.id === fromId) continue
      const sz = (S._nodeSize && S._nodeSize[n.id]) || { w: 180, h: 50 }
      const p = n.pos || { x: 0, y: 0 }
      if (wx >= p.x - PAD && wx <= p.x + sz.w + PAD && wy >= p.y - PAD && wy <= p.y + sz.h + PAD) return n
    }
    return null
  }
  const clearHover = () => {
    cv.querySelectorAll('g[data-hover]').forEach(g => g.removeAttribute('data-hover'))
    cv.querySelectorAll('circle.target-port').forEach(c => c.remove())
  }
  const move = ev => {
    const mx = (ev.clientX - cvRect.left) / S.scale, my = (ev.clientY - cvRect.top) / S.scale
    band.setAttribute('d', `M ${sx} ${sy} L ${mx} ${my}`)
    // 目标节点 hover 提示
    const hit = hoverHit(mx, my)
    const cur = cv.querySelector('g[data-hover]')
    if (cur && (!hit || cur.getAttribute('data-id') !== hit.id)) {
      cur.removeAttribute('data-hover')
      cv.querySelectorAll('circle.target-port').forEach(c => c.remove())
    }
    if (hit) {
      const hg = cv.querySelector('g[data-id="' + hit.id + '"]')
      if (hg && !hg.getAttribute('data-hover')) {
        hg.setAttribute('data-hover', '1')
        _renderTargetPorts(hg)
      }
    }
  }
  const up = ev => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    band.remove()
    clearHover()
    // 命中目标节点（世界坐标 AABB，与框选命中同逻辑——elementsFromPoint 在此环境不可靠）
    // 拖动中滚动会过期 → up 时重取 cvRect；pad 容差抗缩放取整误差（质检抓出）
    const cur = document.getElementById('cv').getBoundingClientRect()
    const wx = (ev.clientX - cur.left) / S.scale
    const wy = (ev.clientY - cur.top) / S.scale
    const PAD = 4 / S.scale
    let toId = null
    for (const n of S.req.nodes) {
      if (n.id === fromId) continue
      const sz = (S._nodeSize && S._nodeSize[n.id]) || { w: 180, h: 50 }
      const p = n.pos || { x: 0, y: 0 }
      if (wx >= p.x - PAD && wx <= p.x + sz.w + PAD && wy >= p.y - PAD && wy <= p.y + sz.h + PAD) { toId = n.id; break }
    }
    if (toId && !S.req.edges.some(r => r.from === fromId && r.to === toId)) {
      S.req.edges.push({ from: fromId, to: toId, label: '', reverse: false })
      S.dirty = true
      pushHistory()
      render()
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ---------- 选择与属性 ----------
// 按下边本体：选中 + 拖边 = 整条边平移（端点钉在节点锚点，中间折点整体移动；
// 对齐 draw.io 拖线行为，避免"按下边不动、像穿透到背景"）
function _onEdgeDown(e, p) {
  e.stopPropagation()
  e.preventDefault() // 阻断浏览器默认文本选择/拖拽
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
  // 新节点必须有 pos（否则 layout 重排位置不稳定 + 用户找不到）：
  // 有选中节点 → 右下偏移；否则 → 画布可视区中心
  let x = 80, y = 80
  if (S.selected && S.selected.kind === 'node') {
    const sel = S.req.nodes.find(n => n.id === S.selected.id)
    if (sel && sel.pos) { x = sel.pos.x + 220; y = sel.pos.y + 60 }
  } else {
    const cw = document.getElementById('canvasWrap')
    if (cw) { x = Math.max(40, Math.round((cw.clientWidth / 2 - 90) / S.scale)); y = Math.max(40, Math.round((cw.clientHeight / 2 - 27) / S.scale)) }
  }
  S.req.nodes.push({ id, dept: '其他', role: '新增', action: '新节点', shape: 'rect', pos: { x, y } })
  // 新节点 dept='其他' 必须并入 lanes（否则 reqToMermaid lanes 分支漏渲染——质检抓出）
  if (!S.req.lanes) S.req.lanes = []
  if (!S.req.lanes.some(l => l.dept === '其他')) S.req.lanes.push({ dept: '其他', roles: ['新增'] })
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
// 初始视图自适应：整个图 fit 到画布可视区（小窗口/大图全部可见可点，修复节点在滚动区外点不到）
// 关键：svgHost transform scale 不参与布局 → 滚动区仍是原始尺寸会产生多余空白滚动区（视口坐标错乱）
// 因此 scale 后必须同步 svgHost 宽高 = 缩放尺寸（滚动区=可视区）
export function fitToView() {
  const cw = document.getElementById('canvasWrap')
  const svg = _svgHost ? _svgHost.querySelector('svg') : null
  if (!cw || !svg) return
  const vw = cw.clientWidth, vh = cw.clientHeight
  const sw = parseFloat(svg.getAttribute('width') || 0), sh = parseFloat(svg.getAttribute('height') || 0)
  if (!vw || !vh || !sw || !sh) return
  const s = Math.min(vw / sw, vh / sh, 1.2)
  S.scale = Math.round(Math.max(0.1, s) * 100) / 100
  _applyScale()
  _updateStatus()
}

// 应用缩放：svgHost transform + 尺寸同步（transform 不参与布局，宽高必须显式设置，
// 否则 canvasWrap 滚动区=原始尺寸，出现空白滚动区且视口坐标错乱——质检抓出）
function _applyScale() {
  const host = _svgHost
  if (!host) return
  host.style.transform = 'scale(' + S.scale + ')'
  const svg = host.querySelector('svg')
  if (svg) {
    host.style.width = Math.round(parseFloat(svg.getAttribute('width') || 0) * S.scale) + 'px'
    host.style.height = Math.round(parseFloat(svg.getAttribute('height') || 0) * S.scale) + 'px'
  }
}

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
  fitToView() // 初始 fit：小窗口/大图时整个图可见可点
  bindInteractions()
  pushHistory() // 初始快照（撤销回到初始态）
  // 画布空白事件
  document.getElementById('canvasWrap').addEventListener('pointerdown', e => {
    if (e.target === host || e.target.id === 'canvasWrap') _onCanvasDown(e)
  })
  // 滚轮缩放（缩放后同步 svgHost 尺寸，避免多余滚动区）
  document.getElementById('canvasWrap').addEventListener('wheel', e => {
    e.preventDefault()
    S.scale = Math.min(2.5, Math.max(0.3, S.scale * (e.deltaY < 0 ? 1.1 : 0.9)))
    _applyScale()
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
