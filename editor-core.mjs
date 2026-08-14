// ============================================================
// editor-core.mjs — 画布编辑器交互层（浏览器 ESM，架构级）
// 单一数据源：req.json（内存对象）→ 复用核心管线渲染 → 编辑写回 → 保存
// 依赖：/lib/ 白名单模块（parse-flow/layout-grid/render-svg/req-util）
// 能力：视口缩放平移 / 节点拖拽(网格吸附+边随动) / 框选 / 双击改文字
//       锚点连边 / 增删节点 / 属性面板(形状/颜色/文本) / 撤销重做(快照栈)
//       主题切换 / 保存验收 / 导出 PNG/PDF
// ============================================================
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
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
  render()
}
export function redo() {
  if (S.historyIdx >= S.history.length - 1) return
  S.historyIdx++
  S.req = JSON.parse(S.history[S.historyIdx])
  S.dirty = true
  render()
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
  const svg = renderSVG(lay, { classDefs: graph.classDefs, title: S.req.title || '', theme: S.theme })
  // 注入交互属性
  let doc = svg.replace(/<svg /, '<svg id="cv" ')
  // 节点 g 加 data-id（通过文本定位太脆，直接在渲染后按顺序注入）
  const out = _svgHost
  out.innerHTML = doc
  // 节点 g 加 data-id：标在**外层 translate g**（svg 直接子级）——包含形状+文字，
  // 点击文字/形状任何位置 closest 都能命中（标 fill g 的话文字是兄弟节点会漏）
  const nodeOrder = lay.nodes.map(n => n.id)
  let gi = 0
  out.querySelectorAll('svg > g').forEach(g => {
    if (gi < nodeOrder.length) {
      g.setAttribute('data-id', nodeOrder[gi])
      // 选中高亮（点击后视觉反馈）
      if (S.selected && S.selected.kind === 'node' && S.selected.id === nodeOrder[gi]) g.setAttribute('data-sel', '1')
    }
    gi++
  })
  // 记录节点真实尺寸（框选命中检测用）
  S._nodeSize = {}
  lay.nodes.forEach(n => { S._nodeSize[n.id] = { w: n.w, h: n.h } })
  // 边 path 标记：按 DOM 顺序打 data-eidx，并记录 DOM 序 → req.edges 索引映射（布局重排边）
  S._edgeMap = lay.edges.map(e => S.req.edges.findIndex(r => r.from === e.from && r.to === e.to))
  let ei = 0
  out.querySelectorAll('path').forEach(p => {
    if (p.getAttribute('fill') === 'none') {
      p.setAttribute('data-edge', '1')
      p.setAttribute('data-eidx', ei)
      // 选中高亮
      if (S.selected && S.selected.kind === 'edge' && S._edgeMap[ei] === S.selected.idx) p.setAttribute('data-sel', '1')
      ei++
    }
  })
  bindInteractions()
  _updateStatus()
}

// ---------- 交互绑定（事件委托：svg 根一次绑定，不受 innerHTML 重建影响） ----------
export function bindInteractions() {
  const cv = document.getElementById('cv')
  if (!cv || cv._bound) return
  cv._bound = true
  // 节点：pointerdown 拖动 / dblclick 改文字（通过 closest 定位，点文字/形状都命中）
  cv.addEventListener('pointerdown', e => {
    const g = e.target.closest ? e.target.closest('g[data-id]') : null
    if (g) { _onNodeDown(e, g); return }
    // 边
    const p = e.target.closest ? e.target.closest('path[data-edge]') : null
    if (p) { e.stopPropagation(); _selectEdge(p) }
  })
  cv.addEventListener('dblclick', e => {
    const g = e.target.closest ? e.target.closest('g[data-id]') : null
    if (g) _onDblClick(e, g)
  })
}

function _onNodeDown(e, g) {
  e.stopPropagation()
  const id = g.getAttribute('data-id')
  const node = S.req.nodes.find(n => n.id === id)
  if (!node) return
  selectNode(id)
  const startX = e.clientX, startY = e.clientY
  const origX = node.pos ? node.pos.x : 0, origY = node.pos ? node.pos.y : 0
  const move = ev => {
    const dx = (ev.clientX - startX) / S.scale, dy = (ev.clientY - startY) / S.scale
    node.pos = { x: snap(origX + dx), y: snap(origY + dy) }
    render()
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    pushHistory()
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
  const commit = () => {
    const v = input.value.trim()
    if (v && v !== node.action) { node.action = v; S.dirty = true; pushHistory(); render() }
    input.remove()
  }
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') input.remove() })
  input.addEventListener('blur', commit)
}

function _selectEdge(p) {
  const eidx = parseInt(p.getAttribute('data-eidx') || '0', 10)
  // DOM 顺序（lay.edges）→ req.edges 索引映射，避免布局重排错位
  const realIdx = S._edgeMap && S._edgeMap[eidx] !== undefined && S._edgeMap[eidx] >= 0 ? S._edgeMap[eidx] : eidx
  const edge = S.req.edges[realIdx]
  if (!edge) return
  S.selected = { kind: 'edge', idx: realIdx }
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
      <label>文本</label><input id="pText" value="${(n.action || '').replace(/"/g, '&quot;')}">
      <label>形状</label><select id="pShape">${shapes.map(s => `<option ${s === n.shape ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>泳道(部门)</label><input id="pDept" value="${(n.dept || '').replace(/"/g, '&quot;')}">
      <label>角色</label><input id="pRole" value="${(n.role || '').replace(/"/g, '&quot;')}">
      <label>自定义填充色</label><input type="color" id="pFill" value="${n.fill || '#ddf4ff'}">
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
      <label>标签</label><input id="eLabel" value="${(e.label || '').replace(/"/g, '&quot;')}">
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  } catch (e) {
    const st = document.getElementById('saveStatus')
    st.textContent = '❌ 保存失败：' + e.message
    st.className = 'err'
  }
  if (btn) { btn.disabled = false; btn.textContent = '💾 保存' }
}

// ---------- 导出（保存后调现有接口） ----------
export async function exportPng() { await save(); const f = S.file.replace(/\.req\.json$/, '.svg'); window.open('/api/png?file=' + encodeURIComponent(f)) }
export async function exportPdf() { await save(); const f = S.file.replace(/\.req\.json$/, '.svg'); window.open('/api/pdf?file=' + encodeURIComponent(f)) }

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
    else if (e.key === 'Delete' || e.key === 'Backspace') delSelected()
  })
}
