// ============ 链路验证：WorkBuddy 生成 req.json → 在线编辑器打开/编辑/保存/重开 ============
// 模拟 WorkBuddy 生成（真实管线：req → reqToMermaid → parseFlow → layout → renderSVG → 存 req.json）
import { reqToMermaid } from './req-util.mjs'
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'
import fs from 'node:fs'

// ① WorkBuddy 侧：构造需求数据（模拟技能包从需求解析出的结果）
const req = {
  title: '链路验证·采购审批流程',
  lanes: [
    { dept: '采购部', roles: ['采购员', '采购经理'] },
    { dept: '财务部', roles: ['财务审核'] },
  ],
  nodes: [
    { id: 'START', dept: '采购部', role: '采购员', action: '发起采购申请', shape: 'stadium' },
    { id: 'N1', dept: '采购部', role: '采购员', action: '填写采购单', shape: 'rect' },
    { id: 'N2', dept: '采购部', role: '采购经理', action: '审批', shape: 'diamond' },
    { id: 'N3', dept: '财务部', role: '财务审核', action: '财务审核付款', shape: 'rect' },
    { id: 'END', dept: '财务部', role: '财务审核', action: '完成采购', shape: 'stadium' },
  ],
  edges: [
    { from: 'START', to: 'N1', label: '', reverse: false },
    { from: 'N1', to: 'N2', label: '提交', reverse: false },
    { from: 'N2', to: 'N3', label: '通过', reverse: false },
    { from: 'N2', to: 'N1', label: '驳回', reverse: true },
    { from: 'N3', to: 'END', label: '', reverse: false },
  ]
}

// ② 生成链路（与 agent-batch/agent-orchestrator 相同管线）
const g = parseFlow(reqToMermaid(req))
const lay = layout(g.nodes, g.edges, g.groups, g.declaredOrder, 'auto', req.lanes, req.nodes)
lay.nodes.forEach(n => { const rn = req.nodes.find(x => x.id === n.id); if (rn && rn.pos) n.pos = rn.pos })
const svg = renderSVG(lay, { classDefs: {}, title: req.title, theme: 'github-light' })
console.log('② 生成链路: parse', g.nodes.length, '节点 | layout', lay.width + 'x' + lay.height, '| svg', (svg.length/1024).toFixed(1) + 'KB')

// ③ 保存 req.json（含渲染位置 pos，编辑器可加载）
const out = 'verify-chain.req.json'
const saved = { ...req, nodes: req.nodes.map(n => ({ ...n, pos: lay.nodes.find(x => x.id === n.id)?.pos })) }
fs.writeFileSync(out, JSON.stringify(saved, null, 2))
console.log('③ 已保存:', out, fs.statSync(out).size + 'B')

// ④ 编辑器可读性校验（服务端侧：reqToMermaid 幂等）
const g2 = parseFlow(reqToMermaid(JSON.parse(fs.readFileSync(out, 'utf-8'))))
console.log('④ 重读解析: ', g2.nodes.length, '节点 /', g2.edges.length, '边（保存后仍可解析）')
