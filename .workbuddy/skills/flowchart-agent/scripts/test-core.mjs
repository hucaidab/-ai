// ============================================================
// test-core.mjs — 核心模块单元测试（node:test）
// 运行: node --test test-core.mjs
// 覆盖: parse-flow / layout-grid / llm-model(selfCheck/autoFix)
//       / nlp-model / template-finder / req-util
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
import { selfCheck, autoFix, repairSchema } from './llm-model.mjs'
import { modelFromText } from './nlp-model.mjs'
import { findTemplate } from './template-finder.mjs'
import { reqToMermaid } from './req-util.mjs'

// ---------- parse-flow ----------
test('parse: 常规图节点/边/形状', () => {
  const src = `flowchart TD
    A([开始：登录]) --> B{输入合法?}
    B -->|是| C[进入首页]
    B -->|否| A`
  const g = parseFlow(src)
  assert.equal(g.nodes.length, 3)
  assert.equal(g.edges.length, 3)
  assert.equal(g.nodes.find(n => n.id === 'A').shape, 'stadium')
  assert.equal(g.nodes.find(n => n.id === 'B').shape, 'diamond')
})

test('parse: 中文 id 与 :::class 组合', () => {
  const src = `flowchart LR
    subgraph L_采购部["采购部"]
        direction LR
        A[提交申请]:::proc
    end
    A --> B[审批]`
  const g = parseFlow(src)
  assert.ok(g.nodes.some(n => n.id === 'A'), '中文组内节点可解析')
  assert.equal(g.nodes.find(n => n.id === 'A').cls, 'proc')
  assert.ok(g.groups.length >= 1)
})

test('parse: 虚线逆向边与边标签', () => {
  const src = `flowchart TD
    A -->|通过| B
    A -.->|驳回| C
    D -.-> E`
  const g = parseFlow(src)
  const back = g.edges.find(e => e.label === '驳回')
  assert.ok(back, '边标签解析')
  assert.equal(back.style, 'dotted')
  assert.ok(g.edges.some(e => e.label === '通过'))
})

// ---------- layout-grid ----------
test('layout: auto 逆向虚线边不参与分层（无环）', () => {
  const nodes = [
    { id: 'A', shape: 'rect' }, { id: 'B', shape: 'rect' },
    { id: 'C', shape: 'rect' }, { id: 'D', shape: 'rect' },
  ]
  const edges = [
    { from: 'A', to: 'B', style: 'solid' }, { from: 'B', to: 'C', style: 'solid' },
    { from: 'C', to: 'D', style: 'solid' }, { from: 'C', to: 'B', style: 'dotted' },
  ]
  const lay = layout(nodes, edges, [], [], 'auto')
  assert.equal(lay.nodes.length, 4)
  // 4 个节点应在不同层（串行）
  const ys = new Set(lay.nodes.map(n => Math.round(n.y)))
  assert.ok(ys.size >= 3, '串行链应分出 ≥3 层，实际 ' + ys.size)
})

test('layout: swimlane 泳道列不重叠', () => {
  const nodes = [
    { id: 'A1', dept: 'D1' }, { id: 'A2', dept: 'D1' },
    { id: 'B1', dept: 'D2' }, { id: 'B2', dept: 'D2' },
  ]
  const edges = [{ from: 'A1', to: 'B1' }, { from: 'B1', to: 'A2' }]
  const groups = [
    { id: 'G1', label: 'D1', nodeIds: ['A1', 'A2'] },
    { id: 'G2', label: 'D2', nodeIds: ['B1', 'B2'] },
  ]
  const lay = layout(nodes, edges, groups, ['G1', 'G2'], 'swimlane')
  const colX = {}
  lay.nodes.forEach(n => { colX[n.dept] = n.x })
  const x1 = colX.D1, x2 = colX.D2
  assert.ok(Math.abs(x1 - x2) > 100, '泳道 x 应分离：D1=' + x1 + ' D2=' + x2)
})

// ---------- llm-model: selfCheck / autoFix ----------
test('selfCheck: 合法流程 ok', () => {
  const req = {
    nodes: [
      { id: 'N1', shape: 'start', action: '开始：启动' },
      { id: 'N2', shape: 'rect', action: '处理' },
      { id: 'N3', shape: 'end', action: '结束：完成' },
    ],
    edges: [{ from: 'N1', to: 'N2' }, { from: 'N2', to: 'N3' }],
  }
  assert.equal(selfCheck(req).ok, true)
})

test('selfCheck: 缺起止/判断单出口报错', () => {
  const req = {
    nodes: [
      { id: 'N1', shape: 'rect', action: 'A' },
      { id: 'N2', shape: 'diamond', action: '审批?' },
      { id: 'N3', shape: 'rect', action: 'B' },
    ],
    edges: [{ from: 'N1', to: 'N2' }, { from: 'N2', to: 'N3', label: '' }],
  }
  const chk = selfCheck(req)
  assert.equal(chk.ok, false)
  assert.ok(chk.errors.some(e => e.includes('开始')))
  assert.ok(chk.errors.some(e => e.includes('结束')))
  assert.ok(chk.errors.some(e => e.includes('判断')))
})

test('autoFix: 补齐起止/判断标签/驳回回边', () => {
  const req = {
    nodes: [
      { id: 'N1', shape: 'rect', action: '提交', dept: 'A', role: 'r' },
      { id: 'N2', shape: 'diamond', action: '审批?', dept: 'A', role: 'r' },
      { id: 'N3', shape: 'rect', action: '完成', dept: 'A', role: 'r' },
    ],
    edges: [{ from: 'N1', to: 'N2' }, { from: 'N2', to: 'N3', label: '' }],
  }
  const { req: fx, fixed } = autoFix(req)
  assert.ok(fixed.some(f => f.includes('开始')), '补开始: ' + fixed.join())
  assert.ok(fixed.some(f => f.includes('结束')), '补结束')
  assert.ok(fx.nodes.some(n => n.shape === 'start'))
  assert.ok(fx.nodes.some(n => n.shape === 'end'))
  const diamondOuts = fx.edges.filter(e => e.from === 'N2')
  assert.ok(diamondOuts.length >= 2, '判断 ≥2 出口')
  assert.ok(fx.edges.some(e => e.from === 'N2' && e.reverse), '有驳回回边')
  assert.equal(selfCheck(fx).ok, true, '修复后自检通过')
})

test('repairSchema: id 去重/形状合法/泳道归位', () => {
  const req = repairSchema({
    nodes: [
      { id: 'N1', action: 'a' },
      { id: 'N1', action: 'b' },
      { id: 'N3', action: 'c', shape: 'badshape' },
    ],
    edges: [],
  })
  const ids = req.nodes.map(n => n.id)
  assert.equal(new Set(ids).size, ids.length, 'id 唯一')
  assert.ok(['rect', 'diamond', 'start', 'end', 'data', 'subroutine'].includes(req.nodes[2].shape))
  assert.ok(req.lanes.some(l => l.dept === '其他'), '缺 dept 归位')
})

// ---------- nlp-model ----------
test('nlp: DSL 建模（部门/判断/逆向）', () => {
  const text = `标题: 测试
部门: 采购部 (采购员)
部门: 财务部 (出纳)
开始: 采购员.提交申请
判断: 采购员.审批通过?
步骤: 出纳.打款
结束: 出纳.完成
流程: 提交申请 → 审批通过? --通过--> 打款
流程: 审批通过? --驳回--> 提交申请 (逆向)`
  const req = modelFromText(text)
  assert.ok(req.nodes.length >= 4, '节点数 ' + req.nodes.length)
  assert.ok(req.nodes.some(n => n.shape === 'diamond'))
  assert.ok(req.edges.some(e => e.reverse), '逆向边')
  assert.equal(req.lanes.length, 2)
})

// ---------- template-finder ----------
test('template-finder: 开头加权命中正确模板', () => {
  const text = '费用报销流程：员工提交报销单，部门经理审批，财务审核票据合规性，出纳打款，员工确认收款'
  const hit = findTemplate(text)
  assert.ok(hit, '有命中')
  assert.equal(hit.name, 'expense.json', '报销命中 expense，实际 ' + hit.name)
})

test('template-finder: 末尾模板不因 bestScore 恒 0 误胜出（回归 #43）', () => {
  const text = '员工入职流程：HR 发 offer，员工报到，HR 办入职手续，部门领人，IT 配电脑'
  const hit = findTemplate(text)
  assert.equal(hit.name, 'onboarding.json', '入职命中 onboarding，实际 ' + hit.name)
})

// ---------- req-util ----------
test('reqToMermaid: 中文 subgraph id 用安全索引（回归 L_MFA 服务 bug）', () => {
  const req = {
    title: '登录',
    lanes: [{ dept: 'MFA 服务', roles: ['系统'] }],
    nodes: [
      { id: 'N1', dept: 'MFA 服务', role: '系统', action: '开始：校验', shape: 'start' },
      { id: 'N2', dept: 'MFA 服务', role: '系统', action: '结束：通过', shape: 'end' },
    ],
    edges: [{ from: 'N1', to: 'N2' }],
  }
  const src = reqToMermaid(req)
  assert.ok(!src.includes('subgraph L_MFA 服务'), 'subgraph id 无空格')
  const g = parseFlow(src)
  assert.ok(g.groups[0] && g.groups[0].label === 'MFA 服务', '组头标题保留中文')
})

console.log('✅ 全部测试运行完毕（node --test 模式）')
