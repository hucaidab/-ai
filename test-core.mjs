// ============================================================
// test-core.mjs — 核心模块单元测试（node:test）
// 运行: node --test test-core.mjs
// 覆盖: parse-flow / layout-grid / llm-model(selfCheck/autoFix)
//       / nlp-model / template-finder / req-util
// ============================================================
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFlow } from './parse-flow.mjs'
import { layout, routeEdgePoints, rerouteEdges } from './layout-grid.mjs'
import { selfCheck, autoFix, repairSchema } from './llm-model.mjs'
import { modelFromText } from './nlp-model.mjs'
import { findTemplate } from './template-finder.mjs'
import { reqToMermaid } from './req-util.mjs'
import { escHtml } from './editor-core.mjs'

// ---------- 锚点边路由（对齐 draw.io：8 锚点 + 方向感知 Z 型） ----------
test('routeEdgePoints: 出口/入口在节点边界上（不穿节点）+ 正交 Z 型', () => {
  const A = { x: 100, y: 100, w: 180, h: 50 }, B = { x: 500, y: 300, w: 180, h: 50 }
  const onBorder = (p, n) => (p[0] === n.x || p[0] === n.x + n.w || p[1] === n.y || p[1] === n.y + n.h)
  // 水平为主：A 东出、B 西进
  const h = routeEdgePoints(A, B)
  assert.ok(onBorder(h[0], A), '出口在 A 边界上')
  assert.ok(onBorder(h[h.length - 1], B), '入口在 B 边界上')
  assert.ok(h[1][1] === h[0][1] && h[1][0] === h[2][0] && h[3][1] === h[2][1], '正交 Z 型（横平竖直）')
  // 垂直为主：A 南出、B 北进
  const C = { x: 100, y: 100, w: 180, h: 50 }, D = { x: 300, y: 500, w: 180, h: 50 }
  const v = routeEdgePoints(C, D)
  assert.ok(onBorder(v[0], C) && onBorder(v[v.length - 1], D), '垂直出口/入口在边界上')
  assert.ok(v[1][0] === v[0][0] && v[1][1] === v[2][1] && v[3][0] === v[2][0], '垂直 Z 型正交')
  // 斜向：角度 bucket 归 SE/NE 类角锚点（仍在边界上）
  const E = { x: 100, y: 100, w: 180, h: 50 }, F = { x: 300, y: 200, w: 180, h: 50 }
  const s = routeEdgePoints(E, F)
  assert.ok(onBorder(s[0], E) && onBorder(s[s.length - 1], F), '斜向出口/入口在边界上')
  // 退化：完全重合不崩溃
  const same = routeEdgePoints(A, { ...A })
  assert.ok(Array.isArray(same) && same.length >= 2, '重合退化安全')
})

test('routeEdgePoints: 障碍绕行——中段穿障时偏移避开（不穿其他节点）', () => {
  const A = { id: 'A', x: 100, y: 100, w: 180, h: 50 }
  const B = { id: 'B', x: 500, y: 300, w: 180, h: 50 }
  const O = { id: 'O', x: 300, y: 150, w: 180, h: 50 } // 正好挡在 Z 型中段
  const pts = routeEdgePoints(A, B, [A, B, O])
  const segHit = (x0, y0, x1, y1) => {
    const mnX = Math.min(x0, x1), mxX = Math.max(x0, x1), mnY = Math.min(y0, y1), mxY = Math.max(y0, y1)
    return mxX >= O.x && mnX <= O.x + O.w && mxY >= O.y && mnY <= O.y + O.h
  }
  let hit = false
  for (let i = 0; i < pts.length - 1; i++) if (segHit(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) hit = true
  assert.ok(!hit, '绕行后不穿障碍（midX 偏移到 ' + pts[1][0] + '）')
  // 无障碍时行为不变（回归：midX 居中）
  const plain = routeEdgePoints(A, B)
  const expMid = (plain[0][0] + plain[3][0]) / 2
  assert.equal(plain[1][0], expMid, '无障碍时 midX 居中（出口/入口之间）')
  // 排除端点：A/B 自身不作为障碍
  const pts2 = routeEdgePoints(A, B, [A, B])
  assert.equal(pts2[1][0], expMid, 'A/B 自身不参与避障')
})

test('rerouteEdges: pos 覆盖后边路由随节点新位置重算', () => {
  const lay = {
    nodes: [
      { id: 'A', x: 100, y: 100, w: 180, h: 50, pos: { x: 300, y: 100 } },
      { id: 'B', x: 500, y: 300, w: 180, h: 50 },
    ],
    edges: [{ from: 'A', to: 'B', points: [] }],
  }
  rerouteEdges(lay)
  const pts = lay.edges[0].points
  // A pos=(300,100)，出口在 A 新位置边界（x=480 或 x=300 或 y 边界）
  const onNewBorder = pts[0][0] === 300 || pts[0][0] === 480 || pts[0][1] === 100 || pts[0][1] === 150
  assert.ok(onNewBorder, '出口基于 pos 新位置（非旧布局坐标 100）')
})

// ---------- editor-core（浏览器模块的纯函数回归，顶层无 DOM 依赖） ----------
test('editor-core escHtml: 四件套全量转义（回归 XSS 案例8）', () => {
  assert.equal(escHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', '尖括号必须转义')
  assert.equal(escHtml('a & b "q"'), 'a &amp; b &quot;q&quot;', '& 与引号必须转义')
  assert.equal(escHtml(null), '', 'null 安全')
  assert.equal(escHtml(undefined), '', 'undefined 安全')
  assert.equal(escHtml('正常文本'), '正常文本', '普通文本不变')
  // 模拟 XSS payload 注入面板的完整链路：转义后不得出现可执行的 <img
  assert.ok(!escHtml('<img src=x onerror=alert(1)>').includes('<img'), '转义后不得含可执行标签')
})

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

test('repairSchema: P1 强化——判断补?/标签归一/role 精简', () => {
  const req = repairSchema({
    nodes: [
      { id: 'N1', action: '开始：启动', shape: 'start' },
      { id: 'N2', action: '审批通过', shape: 'diamond', dept: '经理部', role: '经理人员' },
      { id: 'N3', action: '处理', shape: 'rect' },
      { id: 'N4', action: '结束：完成', shape: 'end' },
    ],
    edges: [
      { from: 'N1', to: 'N2', label: '' },
      { from: 'N2', to: 'N3', label: '是' },
      { from: 'N2', to: 'N1', label: '否', reverse: true },
    ],
  })
  const d = req.nodes.find(n => n.id === 'N2')
  assert.equal(d.action, '审批通过?', '判断节点自动补?')
  assert.equal(d.role, '经理', 'role 精简"人员"后缀')
  const yes = req.edges.find(e => e.from === 'N2' && e.to === 'N3')
  const no = req.edges.find(e => e.from === 'N2' && e.to === 'N1')
  assert.equal(yes.label, '通过', '是→通过 归一')
  assert.equal(no.label, '驳回', '否→驳回 归一')
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

test('parse: 节点 id 为 END/START 不与 subgraph end 关键字冲突（回归 P0-3）', () => {
  const src = `flowchart TD
    subgraph L0["A"]
        direction LR
        START([开始：启动])
        N1[处理]
        END([结束：完成])
    end
    START --> N1
    N1 --> END`
  const g = parseFlow(src)
  const end = g.nodes.find(n => n.id === 'END')
  const start = g.nodes.find(n => n.id === 'START')
  assert.ok(end, 'END 节点被解析')
  assert.equal(end.shape, 'stadium', 'END 形状保留，实际 ' + end.shape)
  assert.equal(start.shape, 'stadium')
  assert.equal(g.edges.length, 2, '边完整')
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
