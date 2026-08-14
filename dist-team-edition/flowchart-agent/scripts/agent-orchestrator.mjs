// ============================================================
// agent-orchestrator.mjs — 流程图设计智能体编排脚本
// 全流程：需求(JSON/mmd) → 解析 → 布局(自动选型) → 渲染 → 自动验收 → 交付
// 用法:
//   A) 直接渲染 mmd:
//      node agent-orchestrator.mjs in.mmd out.svg [--mode auto|swimlane] [--title 标题]
//         [--expect-text "开始,结束,采购部"] [--expect-reverse 3] [--expect-colors "#0969da,#1f883d"]
//   B) 需求 JSON（规格书 §4.1 输入协议）:
//      node agent-orchestrator.mjs req.json out.svg --req
// 交付: out.svg + out.report.md + out.report.json
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'
import { validateSVG } from './validate.mjs'
import { reqToMermaid } from './req-util.mjs'

const args = process.argv.slice(2)
const getOpt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const useReq = args.includes('--req')
const inputFile = args[0]
const outputFile = args[1]
const mode = getOpt('--mode', 'auto')
const title = getOpt('--title', '')
const expectText = (getOpt('--expect-text', '') || '').split(',').map(s => s.trim()).filter(Boolean)
const expectReverse = parseInt(getOpt('--expect-reverse', '-1'), 10)
const expectColors = (getOpt('--expect-colors', '') || '').split(',').map(s => s.trim()).filter(Boolean)

// ---------- 主流程 ----------
let src, expectNodes = -1
let reqTitle = ''
if (useReq) {
  const req = JSON.parse(fs.readFileSync(inputFile, 'utf-8'))
  src = reqToMermaid(req)
  reqTitle = req.title || ''
  expectNodes = req.nodes ? req.nodes.length : -1
} else {
  src = fs.readFileSync(inputFile, 'utf-8')
}

const graph = parseFlow(src)
const lay = layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, mode)
const svg = renderSVG(lay, { classDefs: graph.classDefs, title: title || reqTitle, subtitle: `模式=${lay.mode}` })

// ---------- 自动验收 ----------
const diamondCount = graph.nodes.filter(n => n.shape === 'diamond').length
const diamondLabeled = graph.edges.filter(e => graph.nodes.find(n => n.id === e.from && n.shape === 'diamond') && e.label).length
const reverseCount = lay.edges.filter(e => e.back || e.style === 'dotted').length
const report = validateSVG(svg, {
  nodeCount: graph.nodes.length,
  edgeCount: graph.edges.length,
  diamondCount,
  diamondLabeledCount: diamondLabeled,
  reverseCount: expectReverse >= 0 ? expectReverse : reverseCount,
  expectText,
  expectColors,
  mode: lay.mode,
})

// ---------- 交付 ----------
const base = outputFile.replace(/\.svg$/, '')
fs.writeFileSync(outputFile, svg, 'utf-8')
const reportJson = JSON.stringify({ ...report, meta: { mode: lay.mode, nodes: graph.nodes.length, edges: graph.edges.length, size: [lay.width, lay.height] } }, null, 2)
fs.writeFileSync(base + '.report.json', reportJson, 'utf-8')

const checkLines = report.checks.map(c => `| ${c.pass ? '✅' : '❌'} | ${c.name} | ${c.detail} |`).join('\n')
const md = `# 流程图验收报告

- **图**：${title || reqTitle || path.basename(inputFile)}
- **模式**：${lay.mode}（节点 ${graph.nodes.length}，边 ${graph.edges.length}，尺寸 ${lay.width.toFixed(0)}×${lay.height.toFixed(0)}）
- **结论**：${report.pass ? '✅ 全部通过' : '❌ ' + report.summary}

| 结果 | 检查项 | 详情 |
|------|--------|------|
${checkLines}

> 由 agent-orchestrator 自动生成（自研渲染管线 V3，零外部依赖）
`
fs.writeFileSync(base + '.report.md', md, 'utf-8')

console.log(`✅ 编排完成: ${outputFile}`)
console.log(`   验收: ${report.summary}`)
console.log(`   报告: ${base}.report.md`)
if (!report.pass) process.exitCode = 2
