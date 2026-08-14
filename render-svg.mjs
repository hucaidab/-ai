// ============================================================
// render-svg.mjs — 自研 SVG 渲染器（零依赖，支持多主题）
// 输入：layout-grid 输出结构 + 主题/classDef
// 形状：rectangle/rounded/diamond/stadium/cylinder/subroutine/
//       circle/doublecircle/hexagon/asymmetric/trapezoid/default
// 主题：github-light（默认）/ github-dark / enterprise-blue / bpmn
// ============================================================

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- 主题定义（语义色 + 部门色板 + 画布） ----------
const THEMES = {
  'github-light': {
    bg: '#ffffff', text: '#1f2328', edge: '#59636e', laneHeader: '#24292f', laneHeaderText: '#ffffff',
    shapes: {
      stadium: { fill: '#1f883d', stroke: '#1a7f37', color: '#ffffff', sw: 2 },
      diamond: { fill: '#fff8c5', stroke: '#9a6700', color: '#633c01', sw: 1.5 },
      cylinder: { fill: '#dafbe1', stroke: '#1a7f37', color: '#0a3d1e', sw: 1.5 },
      subroutine: { fill: '#fbefff', stroke: '#8250df', color: '#3e1f6f', sw: 1.5 },
      default: { fill: '#ddf4ff', stroke: '#0969da', color: '#0a3069', sw: 1.5 },
    },
    palette: [
      { color: '#0969da', tint: '#ddf4ff', label: '#0a3069' },
      { color: '#bc4c00', tint: '#fff1e5', label: '#571f00' },
      { color: '#1a7f37', tint: '#dafbe1', label: '#0a3d1e' },
      { color: '#8250df', tint: '#fbefff', label: '#3e1f6f' },
      { color: '#0e7490', tint: '#e6f6f6', label: '#155e75' },
      { color: '#cf222e', tint: '#ffebe9', label: '#82071e' },
      { color: '#6e7781', tint: '#f6f8fa', label: '#424a53' },
    ],
  },
  'github-dark': {
    bg: '#0d1117', text: '#e6edf3', edge: '#7d8590', laneHeader: '#161b22', laneHeaderText: '#e6edf3',
    shapes: {
      stadium: { fill: '#238636', stroke: '#3fb950', color: '#ffffff', sw: 2 },
      diamond: { fill: '#3d2c00', stroke: '#d29922', color: '#f0d28a', sw: 1.5 },
      cylinder: { fill: '#12261e', stroke: '#3fb950', color: '#7ee787', sw: 1.5 },
      subroutine: { fill: '#2a1e3f', stroke: '#a371f7', color: '#d2a8ff', sw: 1.5 },
      default: { fill: '#0c2d6b', stroke: '#58a6ff', color: '#c8e1ff', sw: 1.5 },
    },
    palette: [
      { color: '#58a6ff', tint: '#0c2d6b', label: '#c8e1ff' },
      { color: '#f0883e', tint: '#3d1f00', label: '#ffc9a3' },
      { color: '#3fb950', tint: '#12261e', label: '#7ee787' },
      { color: '#a371f7', tint: '#2a1e3f', label: '#d2a8ff' },
      { color: '#39c5cf', tint: '#003c40', label: '#a7f0f5' },
      { color: '#f85149', tint: '#3d0d10', label: '#ffb3ac' },
      { color: '#8b949e', tint: '#1c2128', label: '#c9d1d9' },
    ],
  },
  'enterprise-blue': {
    bg: '#f5f8fc', text: '#1a2b4a', edge: '#5b7db1', laneHeader: '#1e4e8c', laneHeaderText: '#ffffff',
    shapes: {
      stadium: { fill: '#2e7d32', stroke: '#1b5e20', color: '#ffffff', sw: 2 },
      diamond: { fill: '#fff8e1', stroke: '#b8860b', color: '#6d4c00', sw: 1.5 },
      cylinder: { fill: '#e3f2fd', stroke: '#1976d2', color: '#0d47a1', sw: 1.5 },
      subroutine: { fill: '#f3e5f5', stroke: '#7b1fa2', color: '#4a148c', sw: 1.5 },
      default: { fill: '#e8f0fe', stroke: '#1e4e8c', color: '#0d2b5e', sw: 1.5 },
    },
    palette: [
      { color: '#1e4e8c', tint: '#e8f0fe', label: '#0d2b5e' },
      { color: '#b34700', tint: '#fff3e6', label: '#6b2c00' },
      { color: '#1e7f4f', tint: '#e6f7ee', label: '#0b3d24' },
      { color: '#6a3fb5', tint: '#f3edfc', label: '#341a63' },
      { color: '#00796b', tint: '#e0f2f1', label: '#004d40' },
      { color: '#c62828', tint: '#ffebee', label: '#7f1010' },
      { color: '#546e7a', tint: '#eceff1', label: '#2c3e4f' },
    ],
  },
  'bpmn': {
    bg: '#fafbfc', text: '#24292e', edge: '#57606a', laneHeader: '#444d56', laneHeaderText: '#ffffff',
    shapes: {
      stadium: { fill: '#f6c945', stroke: '#b08800', color: '#4d3800', sw: 2 },      // 事件-开始（浅黄圆）
      diamond: { fill: '#ffffff', stroke: '#6f42c1', color: '#4b2a8a', sw: 2 },       // 网关-菱形
      cylinder: { fill: '#fff4d6', stroke: '#b08800', color: '#4d3800', sw: 1.5 },    // 数据对象
      subroutine: { fill: '#e6e6fa', stroke: '#6f42c1', color: '#3b1f7a', sw: 1.5 },  // 子流程
      default: { fill: '#e8f4fd', stroke: '#2188ff', color: '#044289', sw: 1.5 },     // 活动-圆角矩形
    },
    palette: [
      { color: '#2188ff', tint: '#e8f4fd', label: '#044289' },
      { color: '#f66a0a', tint: '#fff3e8', label: '#7a3200' },
      { color: '#2da44e', tint: '#e8f8ee', label: '#0f4a22' },
      { color: '#bf3989', tint: '#fbeaf4', label: '#641f48' },
      { color: '#00b8a9', tint: '#e0faf7', label: '#005c54' },
      { color: '#d73a49', tint: '#ffebee', label: '#7a0f1a' },
      { color: '#6e7781', tint: '#f0f2f4', label: '#3a4148' },
    ],
  },
}

export function listThemes() { return Object.keys(THEMES) }

function getTheme(name) { return THEMES[name] || THEMES['github-light'] }

// 语义默认色（按主题）
function defaultStyle(shape, theme) {
  const t = theme.shapes[shape] || theme.shapes.default
  return { ...t }
}

// 部门/角色色板（泳道模式自动分配）
function getPalette(theme) { return theme.palette }

function resolveStyle(node, classDefs, nodeCol, paletteActive, theme) {
  const base = defaultStyle(node.shape, theme)
  const cd = classDefs && node.cls ? classDefs[node.cls] : null
  if (cd) {
    return {
      fill: cd.fill || base.fill,
      stroke: cd.stroke || base.stroke,
      color: cd.color || cd.fontcolor || base.color,
      sw: parseFloat(cd['stroke-width']) || base.sw,
      dash: cd['stroke-dasharray'] || '',
    }
  }
  // 节点级自定义颜色（编辑器属性面板设置，最高优先）
  if (node.fill) {
    return { fill: node.fill, stroke: node.stroke || base.stroke, color: node.color || base.color, sw: base.sw, dash: node.dash || '' }
  }
  if (paletteActive && nodeCol.has(node.id)) {
    const p = getPalette(theme)[nodeCol.get(node.id) % getPalette(theme).length]
    // 起止/判断保留语义色（绿/黄）
    if (node.shape === 'stadium' || node.shape === 'ellipse' || node.shape === 'diamond') return base
    return { fill: p.tint, stroke: p.color, color: p.label, sw: 1.5, dash: '' }
  }
  return base
}

// ---------- 形状路径 ----------
function shapeBody(n) {
  const { x, y, w, h, cx, cy } = n
  switch (n.shape) {
    case 'diamond':
      return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}"/>`
    case 'stadium': case 'ellipse':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ry="${h / 2}"/>`
    case 'cylinder': {
      const r = w / 2, top = y + 8
      return `<path d="M ${x} ${top} a ${r} ${8} 0 0 1 ${w} 0 v ${h - 16} a ${r} ${8} 0 0 1 ${-w} 0 z"/>`
    }
    case 'subroutine':
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>` +
        `<line x1="${x + 10}" y1="${y}" x2="${x + 10}" y2="${y + h}" />` +
        `<line x1="${x + w - 10}" y1="${y}" x2="${x + w - 10}" y2="${y + h}" />`
    case 'circle':
      return `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}"/>`
    case 'doublecircle':
      return `<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}"/><circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2 - 7}"/>`
    case 'hexagon': {
      const a = w / 2, b = h / 2
      return `<polygon points="${cx - a},${cy} ${cx - a / 2},${cy - b} ${cx + a / 2},${cy - b} ${cx + a},${cy} ${cx + a / 2},${cy + b} ${cx - a / 2},${cy + b}"/>`
    }
    case 'asymmetric':
      return `<polygon points="${x},${y} ${x + w},${y} ${x + w - 14},${y + h} ${x},${y + h}"/>`
    case 'trapezoid':
      return `<polygon points="${x + 14},${y} ${x + w},${y} ${x + w - 14},${y + h} ${x},${y + h}"/>`
    case 'trapezoid-alt':
      return `<polygon points="${x},${y} ${x + w - 14},${y} ${x + w},${y + h} ${x + 14},${y + h}"/>`
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`
  }
}

// ---------- 文本（支持 <br/> 换行）----------
function shapeText(n, style) {
  const parts = n.label.split(/<br\s*\/?>/i)
  const cx = n.cx
  const cy = n.cy
  let out = ''
  const fs = n.shape === 'diamond' ? 11.5 : 12
  const lineH = 15
  const startY = cy - (parts.length - 1) * lineH / 2 + 4.5
  parts.forEach((p, i) => {
    out += `<text x="${cx}" y="${startY + i * lineH}" text-anchor="middle" font-size="${fs}" font-weight="600" fill="${style.color}">${esc(p.trim())}</text>`
  })
  return out
}

// ---------- 正交路径 ----------
function orthoPath(pts) {
  if (!pts.length) return ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`
  return d
}

// ---------- 主渲染 ----------
export function renderSVG(layout, { classDefs = {}, title = '', subtitle = '', theme: themeName = 'github-light' } = {}) {
  const theme = getTheme(themeName)
  const { nodes, edges, width, height, mode, cols } = layout
  const nodeCol = new Map()
  const W = Math.max(width, 200), H = Math.max(height, 150)
  const P = getPalette(theme)
  let s = ''
  s += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:${theme.bg};font-family:'Microsoft YaHei',system-ui,sans-serif">`
  s += `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${theme.edge}"/></marker></defs>`

  // 泳道模式：树形容器渲染（draw.io 风格——空泳道保留/角色横向分栏/任意深度嵌套）
  // lay.cols 为泳道树（layout-grid 产出，含几何 x/y/w/h + children + roleCols）
  if (mode === 'swimlane' && cols) {
    const LANE_HEAD = 44 // 与 layout-grid HEAD_H 一致
    const renderLane = (lane, depth, idx) => {
      const pc = P[(depth + idx) % P.length]
      // 容器包进 g[data-lane]（点击文字/背景任何位置 closest 都能命中——text 与 rect 平级会漏，同节点 data-id 教训）
      s += `<g data-lane="${esc(lane.label)}" data-lane-depth="${depth}">`
      // 容器背景
      s += `<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${lane.h}" fill="${theme.bg}" stroke="${theme.edge}" stroke-width="1" opacity="0.55"/>`
      // 泳道头部（色板按层级+索引）
      s += `<rect x="${lane.x}" y="${lane.y}" width="${lane.w}" height="${LANE_HEAD}" fill="${pc.color}"/>`
      s += `<text x="${lane.x + lane.w / 2}" y="${lane.y + LANE_HEAD / 2 + 4}" text-anchor="middle" font-size="13.5" font-weight="700" fill="${theme.laneHeaderText}">${esc(lane.label)}</text>`
      // 角色分栏（横向并排）：分隔线 + 角色标签（栏顶部）
      lane.roleCols.forEach(rc => {
        s += `<rect x="${rc.x}" y="${rc.y}" width="${rc.w}" height="${rc.h}" fill="transparent" stroke="${theme.edge}" stroke-width="0.8" stroke-dasharray="4 3" opacity="0.45" data-lane-role="${esc(rc.label)}"/>`
        s += `<text x="${rc.x + rc.w / 2}" y="${rc.y + 15}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${theme.muted}">${esc(rc.label)}</text>`
      })
      // 子泳道递归（多层）
      lane.children.forEach((c, j) => renderLane(c, depth + 1, j))
      s += `</g>`
    }
    cols.forEach((c, i) => renderLane(c, 0, i))
    // 泳道色板映射节点（递归收集子泳道/角色栏内节点，统一取顶层泳道色）
    const collect = (lane, ci) => {
      lane.roleCols.forEach(rc => rc.nodeIds.forEach(id => nodeCol.set(id, ci)))
      lane.children.forEach(c => collect(c, ci))
    }
    cols.forEach((c, ci) => collect(c, ci))
  }

  // 边（先画）
  edges.forEach((e, i) => {
    if (!e.points.length) return
    const dash = e.style === 'dotted' || e.back ? ' stroke-dasharray="6 4"' : ''
    const sw = e.style === 'thick' ? 2.6 : 1.4
    // data-edge/data-eidx：交互标记下沉到渲染层（编辑器直接消费，消除注入顺序依赖）
    s += `<path d="${orthoPath(e.points)}" fill="none" stroke="${theme.edge}" stroke-width="${sw}"${dash} marker-end="url(#arr)" data-edge="1" data-eidx="${i}"/>`
    if (e.label) {
      const mid = e.points[Math.floor(e.points.length / 2)]
      s += `<text x="${mid[0]}" y="${mid[1] - 7}" text-anchor="middle" font-size="10.5" fill="${theme.edge}" paint-order="stroke" stroke="${theme.bg}" stroke-width="3">${esc(e.label)}</text>`
    }
  })

  // 节点（编辑器模式：pos 覆盖自动布局位置）
  nodes.forEach(n => {
    const st = resolveStyle(n, classDefs, nodeCol, mode === 'swimlane', theme)
    const dashAttr = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
    // 位置承载在 g transform，形状/文字用**本地坐标**（原点 0,0）——
    // 拖动时编辑器只改 transform 即视觉跟随，不会与绝对坐标叠加（乱飘根因修复）
    const real = n.pos ? { ...n, x: n.pos.x, y: n.pos.y, cx: n.pos.x + n.w / 2, cy: n.pos.y + n.h / 2 } : n
    const loc = { ...n, x: 0, y: 0, cx: n.w / 2, cy: n.h / 2 }
    // data-id：渲染层直接输出节点 id（编辑器交互定位用，顺序天然与 DOM 一致）
    s += `<g transform="translate(${real.x},${real.y})" data-id="${n.id}">`
    s += `<g fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.sw}"${dashAttr}>${shapeBody(loc)}</g>`
    s += shapeText(loc, st)
    s += `</g>`
  })

  // 标题
  if (title) {
    s += `<text x="${50}" y="24" font-size="15" font-weight="700" fill="${theme.text}">${esc(title)}</text>`
    if (subtitle) s += `<text x="${50 + 320}" y="24" font-size="10.5" fill="${theme.edge}">${esc(subtitle)}</text>`
  }

  s += '</svg>'
  return s
}
