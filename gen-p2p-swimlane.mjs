// ============================================================
// ERP 采购到付款（P2P）部门 + 岗位两级泳道图 - 自研布局器 v3
// 结构：大列 = 部门；子列 = 岗位
//   v3 新增：生产部（使用环节），入库后生产领用 → 使用不良品退货（换货补货循环）
// 实线=正向流转，虚线=逆向/异常
// ============================================================
import fs from 'node:fs'

// ---------- 布局常量 ----------
const MARGIN = 40
const SUB_W = 132
const SUB_GAP = 18
const DEPT_GAP = 70
const ROW_H = 128
const NODE_W = 112, NODE_H = 52
const DM_W = 124, DM_H = 78
const EL_W = 116, EL_H = 46
const DEPT_HEAD_H = 44
const SUB_HEAD_H = 26

// ---------- 部门与岗位 ----------
const DEPTS = [
  { id: 'pur', name: '采购部', sub: 'Purchasing',  color: '#0969da', tint: '#ddf4ff', label: '#0a3069',
    roles: [ { id: 'pur_buyer', name: '采购员' }, { id: 'pur_mgr', name: '采购经理' } ] },
  { id: 'sup', name: '供应商', sub: 'Supplier',    color: '#bc4c00', tint: '#fff1e5', label: '#571f00',
    roles: [ { id: 'sup', name: '供应商' } ] },
  { id: 'wh',  name: '仓储质检部', sub: 'Warehouse & QC', color: '#1a7f37', tint: '#dafbe1', label: '#0a3d1e',
    roles: [ { id: 'wh_keeper', name: '仓库' }, { id: 'wh_qc', name: '质检' } ] },
  { id: 'prd', name: '生产部', sub: 'Production',  color: '#0e7490', tint: '#e6f6f6', label: '#155e75',
    roles: [ { id: 'prd_usr', name: '生产领料员' } ] },
  { id: 'fin', name: '财务部', sub: 'Finance',     color: '#8250df', tint: '#fbefff', label: '#3e1f6f',
    roles: [ { id: 'fin_ap', name: '应付会计' }, { id: 'fin_cash', name: '出纳' } ] },
]
const deptMap = Object.fromEntries(DEPTS.map(d => [d.id, d]))
const roleDept = {}
const roleIdx = {}
DEPTS.forEach(d => d.roles.forEach((r, i) => { roleDept[r.id] = d.id; roleIdx[r.id] = i }))

const deptX = {}
const roleX = {}
let acc = MARGIN
for (const d of DEPTS) {
  deptX[d.id] = acc
  d.roles.forEach((r, i) => { roleX[r.id] = acc + i * (SUB_W + SUB_GAP) })
  acc += d.roles.length * SUB_W + (d.roles.length - 1) * SUB_GAP + DEPT_GAP
}
const totalW = acc - DEPT_GAP + MARGIN

// ---------- 节点 ----------
const ROWS = [
  { nodes: [{ id: 'P0', dept: 'pur', role: 'pur_buyer', shape: 'ellipse', lines: ['开始', '产生采购需求'] }] },
  { nodes: [{ id: 'P1', dept: 'pur', role: 'pur_buyer', shape: 'rect', lines: ['提交采购申请 PR'] }] },
  { nodes: [{ id: 'P2', dept: 'pur', role: 'pur_mgr', shape: 'diamond', lines: ['审批通过?'] }] },
  { nodes: [{ id: 'P3', dept: 'pur', role: 'pur_buyer', shape: 'rect', lines: ['下达采购订单 PO'] }] },
  { nodes: [{ id: 'S1', dept: 'sup', role: 'sup', shape: 'rect', lines: ['备货并发货'] }] },
  { nodes: [{ id: 'W1', dept: 'wh', role: 'wh_keeper', shape: 'rect', lines: ['到货收货'] }] },
  { nodes: [{ id: 'W2', dept: 'wh', role: 'wh_qc', shape: 'rect', lines: ['来料检验'] }] },
  { nodes: [{ id: 'W3', dept: 'wh', role: 'wh_qc', shape: 'diamond', lines: ['检验合格?'] }] },
  { nodes: [{ id: 'W4', dept: 'wh', role: 'wh_keeper', shape: 'rect', lines: ['入库并更新库存'] }] },
  // v3：入库后进入使用环节（生产部）
  { nodes: [{ id: 'M1', dept: 'prd', role: 'prd_usr', shape: 'rect', lines: ['生产领用 / 投入使用'] }] },
  { nodes: [{ id: 'M2', dept: 'prd', role: 'prd_usr', shape: 'diamond', lines: ['使用中发现不良品?'] }] },
  { nodes: [
      { id: 'S2', dept: 'sup', role: 'sup', shape: 'rect', lines: ['开具发票'] },
      { id: 'P4', dept: 'pur', role: 'pur_buyer', shape: 'rect', lines: ['提交收货单与订单'] },
  ]},
  { nodes: [{ id: 'F1', dept: 'fin', role: 'fin_ap', shape: 'rect', lines: ['三单匹配（PO/入库/发票）'] }] },
  { nodes: [{ id: 'F2', dept: 'fin', role: 'fin_ap', shape: 'diamond', lines: ['匹配通过?'] }] },
  { nodes: [{ id: 'F3', dept: 'fin', role: 'fin_ap', shape: 'rect', lines: ['登记应付账款'] }] },
  { nodes: [{ id: 'F4', dept: 'fin', role: 'fin_cash', shape: 'rect', lines: ['银行付款'] }] },
  { nodes: [{ id: 'S3', dept: 'sup', role: 'sup', shape: 'rect', lines: ['收款并确认'] }] },
  { nodes: [{ id: 'F5', dept: 'fin', role: 'fin_ap', shape: 'rect', lines: ['账务核销'] }] },
  { nodes: [{ id: 'F6', dept: 'fin', role: 'fin_ap', shape: 'ellipse', lines: ['结束', '付款完成'] }] },
]
const totalH = MARGIN * 2 + DEPT_HEAD_H + ROWS.length * ROW_H + 20

const nodePos = {}
ROWS.forEach((r, ri) => {
  const cy = MARGIN + DEPT_HEAD_H + ri * ROW_H + ROW_H / 2
  r.nodes.forEach(n => {
    const x0 = roleX[n.role]
    const w = n.shape === 'diamond' ? DM_W : n.shape === 'ellipse' ? EL_W : NODE_W
    const h = n.shape === 'diamond' ? DM_H : n.shape === 'ellipse' ? EL_H : NODE_H
    nodePos[n.id] = { x: x0 + (SUB_W - w) / 2, y: cy - h / 2, w, h, cx: x0 + SUB_W / 2, cy, dept: n.dept, role: n.role, ...n }
  })
})

// ---------- 边 ----------
const EDGES = [
  // 采购部内
  { f: 'P0', t: 'P1', label: '' },
  { f: 'P1', t: 'P2', label: '申请' },
  { f: 'P2', t: 'P3', label: '通过' },
  { f: 'P2', t: 'P1', label: '驳回·修改重提', dash: true },
  // 跨部门（正向）
  { f: 'P3', t: 'S1', label: '下达 PO' },
  { f: 'S1', t: 'W1', label: '送货' },
  // 仓储质检部内
  { f: 'W1', t: 'W2', label: '报检' },
  { f: 'W2', t: 'W3', label: '' },
  { f: 'W3', t: 'W4', label: '合格' },
  // 逆向：收货拒收 / 检验不合格退货
  { f: 'W1', t: 'S1', label: '收货不符·拒收', dash: true },
  { f: 'W3', t: 'S1', label: '不合格·退货', dash: true },
  // v3：入库 → 生产领用 → 使用；不良品退货 + 换货补货
  { f: 'W4', t: 'M1', label: '领用出库' },
  { f: 'W4', t: 'P4', label: '入库完成' },
  { f: 'M1', t: 'M2', label: '' },
  { f: 'M2', t: 'S1', label: '不良品退货', dash: true },
  { f: 'S1', t: 'W1', label: '换货补发', dash: true },
  // 单据流转 → 财务
  { f: 'S2', t: 'F1', label: '发票' },
  { f: 'P4', t: 'F1', label: '提交单据' },
  // 财务部内
  { f: 'F1', t: 'F2', label: '' },
  { f: 'F2', t: 'F3', label: '通过' },
  { f: 'F2', t: 'F1', label: '不通过·重新匹配', dash: true },
  { f: 'F3', t: 'F4', label: '付款申请' },
  // 付款、收款确认
  { f: 'F4', t: 'S3', label: '付款' },
  { f: 'S3', t: 'F5', label: '收款确认' },
  // 逆向：发票退回 / 退票拒付 / 对账差异
  { f: 'F1', t: 'S2', label: '发票不符·退回重开', dash: true },
  { f: 'S3', t: 'F4', label: '退票 / 拒收货款', dash: true },
  { f: 'F5', t: 'S3', label: '对账差异·调整', dash: true },
  { f: 'F5', t: 'F6', label: '' },
]

// ---------- 路由 ----------
function routeEdge(f, t) {
  const A = nodePos[f], B = nodePos[t]
  const pts = []
  if (A.role === B.role) {
    if (B.cy > A.cy) pts.push([A.cx, A.y + A.h], [A.cx, B.y])
    else pts.push([A.cx, A.y], [A.cx, B.y + B.h])
  } else if (A.dept === B.dept) {
    const ri = roleIdx[A.role], rj = roleIdx[B.role]
    if (rj > ri) {
      const chX = roleX[A.role] + SUB_W + SUB_GAP / 2
      pts.push([A.x + A.w, A.cy], [chX, A.cy], [chX, B.cy], [B.x, B.cy])
    } else {
      const chX = roleX[A.role] - SUB_GAP / 2
      pts.push([A.x, A.cy], [chX, A.cy], [chX, B.cy], [B.x + B.w, B.cy])
    }
  } else {
    const ai = DEPTS.findIndex(d => d.id === A.dept)
    const bi = DEPTS.findIndex(d => d.id === B.dept)
    if (bi > ai) {
      const d = deptMap[A.dept]
      const chX = deptX[A.dept] + d.roles.length * SUB_W + (d.roles.length - 1) * SUB_GAP + DEPT_GAP / 2
      pts.push([A.x + A.w, A.cy], [chX, A.cy], [chX, B.cy], [B.x, B.cy])
    } else {
      const chX = deptX[A.dept] - DEPT_GAP / 2
      pts.push([A.x, A.cy], [chX, A.cy], [chX, B.cy], [B.x + B.w, B.cy])
    }
  }
  return pts
}
function orthoPath(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`
  return d
}

// ---------- SVG ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let svg = ''
svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" style="background:#ffffff;font-family:'Microsoft YaHei',system-ui,sans-serif">`
svg += `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#57606a"/></marker></defs>`

const laneH = totalH - MARGIN * 2
for (const d of DEPTS) {
  const dw = d.roles.length * SUB_W + (d.roles.length - 1) * SUB_GAP
  svg += `<rect x="${deptX[d.id]}" y="${MARGIN}" width="${dw}" height="${laneH}" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1"/>`
  svg += `<rect x="${deptX[d.id]}" y="${MARGIN}" width="${dw}" height="${DEPT_HEAD_H}" fill="${d.color}"/>`
  svg += `<text x="${deptX[d.id] + dw / 2}" y="${MARGIN + 18}" text-anchor="middle" font-size="14" font-weight="700" fill="#ffffff">${esc(d.name)}</text>`
  svg += `<text x="${deptX[d.id] + dw / 2}" y="${MARGIN + 34}" text-anchor="middle" font-size="9" fill="#ffffff" opacity="0.85">${esc(d.sub)}</text>`
  d.roles.forEach((r, i) => {
    const rx = deptX[d.id] + i * (SUB_W + SUB_GAP)
    svg += `<rect x="${rx}" y="${MARGIN + DEPT_HEAD_H}" width="${SUB_W}" height="${SUB_HEAD_H}" fill="${d.tint}" stroke="${d.color}" stroke-width="0.8"/>`
    svg += `<text x="${rx + SUB_W / 2}" y="${MARGIN + DEPT_HEAD_H + 17}" text-anchor="middle" font-size="10" font-weight="600" fill="${d.label}">${esc(r.name)}</text>`
  })
}

for (const e of EDGES) {
  const pts = routeEdge(e.f, e.t)
  const dash = e.dash ? ' stroke-dasharray="6 4"' : ''
  svg += `<path d="${orthoPath(pts)}" fill="none" stroke="#57606a" stroke-width="1.4"${dash} marker-end="url(#arr)"/>`
  if (e.label) {
    const mid = pts[Math.floor(pts.length / 2)]
    svg += `<text x="${mid[0]}" y="${mid[1] - 7}" text-anchor="middle" font-size="10.5" fill="#57606a" paint-order="stroke" stroke="#ffffff" stroke-width="3">${esc(e.label)}</text>`
  }
}

for (const n of Object.values(nodePos)) {
  const d = deptMap[n.dept]
  const { x, y, w, h, cx, cy } = n
  let body = ''
  if (n.shape === 'diamond') {
    body = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="#fff8c5" stroke="#9a6700" stroke-width="1.5"/>`
  } else if (n.shape === 'ellipse') {
    body = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="#1f883d" stroke="#1a7f37" stroke-width="2"/>`
  } else {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${d.tint}" stroke="${d.color}" stroke-width="1.5"/>`
  }
  svg += body
  const fg = n.shape === 'ellipse' ? '#ffffff' : d.label
  if (n.shape === 'ellipse') {
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="11" fill="#ffffff">${esc(n.lines[0])}</text>`
    svg += `<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff">${esc(n.lines[1] || '')}</text>`
  } else {
    svg += `<text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="11" font-weight="600" fill="${fg}">${esc(n.lines[0])}</text>`
  }
}

svg += `<text x="${MARGIN}" y="22" font-size="15" font-weight="700" fill="#24292f">ERP 采购到付款（P2P）· 部门 + 岗位两级泳道图（含生产使用环节）</text>`
svg += `<text x="${MARGIN + 420}" y="22" font-size="10.5" fill="#57606a">实线=正向 · 虚线=逆向/异常（驳回/拒收/退货/不良品/退票/退发票/对账）· 大列=部门 子列=岗位</text>`

svg += '</svg>'

fs.writeFileSync('C:/Users/1/WorkBuddy/2026-08-12-15-26-19/diagram-erp-p2p-roles.svg', svg, 'utf-8')
console.log('✅ P2P 泳道图（含生产部）生成: diagram-erp-p2p-roles.svg')
console.log('   尺寸: ' + totalW + ' x ' + totalH)
