// ============================================================
// render-svg.mjs — 自研 SVG 渲染器（零依赖）
// 输入：layout-grid 输出结构 + 主题/classDef
// 形状：rectangle/rounded/diamond/stadium/cylinder/subroutine/
//       circle/doublecircle/hexagon/asymmetric/trapezoid/default
// 颜色：语义默认色（起止绿/判断黄/数据绿/子流程紫/备注灰）+ classDef 覆盖
// ============================================================

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 语义默认色（github-light 系）
function defaultStyle(shape) {
  if (shape === 'stadium' || shape === 'ellipse') return { fill: '#1f883d', stroke: '#1a7f37', color: '#ffffff', sw: 2 }
  if (shape === 'diamond') return { fill: '#fff8c5', stroke: '#9a6700', color: '#633c01', sw: 1.5 }
  if (shape === 'cylinder') return { fill: '#dafbe1', stroke: '#1a7f37', color: '#0a3d1e', sw: 1.5 }
  if (shape === 'subroutine') return { fill: '#fbefff', stroke: '#8250df', color: '#3e1f6f', sw: 1.5 }
  return { fill: '#ddf4ff', stroke: '#0969da', color: '#0a3069', sw: 1.5 }
}

// 部门/角色色板（泳道模式自动分配：蓝 橙 绿 紫 青 红 灰）
const PALETTE = [
  { color: '#0969da', tint: '#ddf4ff', label: '#0a3069' },
  { color: '#bc4c00', tint: '#fff1e5', label: '#571f00' },
  { color: '#1a7f37', tint: '#dafbe1', label: '#0a3d1e' },
  { color: '#8250df', tint: '#fbefff', label: '#3e1f6f' },
  { color: '#0e7490', tint: '#e6f6f6', label: '#155e75' },
  { color: '#cf222e', tint: '#ffebe9', label: '#82071e' },
  { color: '#6e7781', tint: '#f6f8fa', label: '#424a53' },
]

function resolveStyle(node, classDefs, nodeCol, paletteActive) {
  const base = defaultStyle(node.shape)
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
  if (paletteActive && nodeCol.has(node.id)) {
    const p = PALETTE[nodeCol.get(node.id) % PALETTE.length]
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
export function renderSVG(layout, { classDefs = {}, title = '', subtitle = '' } = {}) {
  const { nodes, edges, width, height, mode, cols } = layout
  const nodeCol = new Map()
  const W = Math.max(width, 200), H = Math.max(height, 150)
  let s = ''
  s += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#ffffff;font-family:'Microsoft YaHei',system-ui,sans-serif">`
  s += `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#57606a"/></marker></defs>`

  // 泳道模式：组列背景 + 组头（按部门色板着色）
  if (mode === 'swimlane' && cols) {
    cols.forEach((c, i) => c.nodeIds.forEach(id => nodeCol.set(id, i)))
    const laneH = H - 50 * 2
    const colXMap = {}
    let acc = 50
    cols.forEach((c, i) => { colXMap[i] = acc; acc += 260 + 84 })
    cols.forEach((c, i) => {
      const x = colXMap[i]
      const pc = PALETTE[i % PALETTE.length]
      s += `<rect x="${x}" y="50" width="${260}" height="${laneH}" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1"/>`
      s += `<rect x="${x}" y="50" width="${260}" height="${44}" fill="${pc.color}"/>`
      s += `<text x="${x + 130}" y="${78}" text-anchor="middle" font-size="13.5" font-weight="700" fill="#ffffff">${esc(c.label)}</text>`
    })
  }

  // 边（先画）
  edges.forEach(e => {
    if (!e.points.length) return
    const dash = e.style === 'dotted' || e.back ? ' stroke-dasharray="6 4"' : ''
    const sw = e.style === 'thick' ? 2.6 : 1.4
    s += `<path d="${orthoPath(e.points)}" fill="none" stroke="#57606a" stroke-width="${sw}"${dash} marker-end="url(#arr)"/>`
    if (e.label) {
      const mid = e.points[Math.floor(e.points.length / 2)]
      s += `<text x="${mid[0]}" y="${mid[1] - 7}" text-anchor="middle" font-size="10.5" fill="#57606a" paint-order="stroke" stroke="#ffffff" stroke-width="3">${esc(e.label)}</text>`
    }
  })

  // 节点
  nodes.forEach(n => {
    const st = resolveStyle(n, classDefs, nodeCol, mode === 'swimlane')
    const dashAttr = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
    s += `<g transform="translate(0,0)">`
    s += `<g fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.sw}"${dashAttr}>${shapeBody(n)}</g>`
    s += shapeText(n, st)
    s += `</g>`
  })

  // 标题
  if (title) {
    s += `<text x="${50}" y="24" font-size="15" font-weight="700" fill="#24292f">${esc(title)}</text>`
    if (subtitle) s += `<text x="${50 + 320}" y="24" font-size="10.5" fill="#57606a">${esc(subtitle)}</text>`
  }

  s += '</svg>'
  return s
}
