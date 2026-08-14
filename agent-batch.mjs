// ============================================================
// agent-batch.mjs — 批量出图（V4）
// 用法:
//   node agent-batch.mjs req1.json req2.json ... [--out 前缀]
//   node agent-batch.mjs --dir <目录>          # 扫描目录下所有 *.json（跳过 *_out）
// 每个需求：req → mmd → 渲染 → 自动验收（自动生成断言）→ SVG + 报告
// 汇总输出: batch-report.md / batch-report.json
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'
import { validateSVG } from './validate.mjs'
import { reqToMermaid } from './req-util.mjs'

const args = process.argv.slice(2)
const PALETTE = ['#0969da', '#bc4c00', '#1a7f37', '#8250df', '#0e7490', '#cf222e', '#6e7781']

function processReq(req, outBase) {
  const src = reqToMermaid(req)
  const graph = parseFlow(src)
  const lay = layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, 'auto')
  const svg = renderSVG(lay, { classDefs: graph.classDefs, title: req.title || '', subtitle: `模式=${lay.mode}` })

  // 自动生成断言
  const expectText = (req.lanes || []).map(l => l.dept).concat(
    req.nodes.filter(n => n.shape === 'start' || n.shape === 'end').map(n => n.action)
  )
  const expectReverse = req.edges.filter(e => e.reverse).length
  const laneCount = (req.lanes || []).length
  const expectColors = PALETTE.slice(0, Math.max(laneCount, 1)).concat(['#1f883d', '#fff8c5'])

  const report = validateSVG(svg, {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    diamondCount: graph.nodes.filter(n => n.shape === 'diamond').length,
    diamondLabeledCount: graph.edges.filter(e => graph.nodes.find(n => n.id === e.from && n.shape === 'diamond') && e.label).length,
    reverseCount: expectReverse,
    expectText,
    expectColors,
    mode: lay.mode,
  })

  const svgFile = outBase + '.svg'
  fs.writeFileSync(svgFile, svg, 'utf-8')
  const md = `# ${req.title || path.basename(outBase)} — 验收报告\n\n- 模式：${lay.mode}，节点 ${graph.nodes.length}，边 ${graph.edges.length}\n- 结论：${report.pass ? '✅ 通过' : '❌ ' + report.summary}\n\n${report.checks.map(c => `| ${c.pass ? '✅' : '❌'} | ${c.name} | ${c.detail} |`).join('\n')}\n`
  fs.writeFileSync(outBase + '.report.md', md, 'utf-8')
  fs.writeFileSync(outBase + '.report.json', JSON.stringify(report, null, 2), 'utf-8')
  return { name: path.basename(outBase), title: req.title, pass: report.pass, summary: report.summary, nodes: graph.nodes.length, edges: graph.edges.length }
}

// ---------- 主流程 ----------
let files = []
const dirIdx = args.indexOf('--dir')
if (dirIdx >= 0 && args[dirIdx + 1]) {
  const dir = args[dirIdx + 1]
  files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') && !f.includes('.report.') && f !== 'batch-report.json' && f !== 'package.json')
    .map(f => path.join(dir, f))
} else {
  files = args.filter(a => a.endsWith('.json') && !a.startsWith('--') && !a.includes('.report.'))
}
if (!files.length) { console.error('未找到 req.json，用法: node agent-batch.mjs req1.json ... 或 --dir <目录>'); process.exit(1) }

const results = []
for (const f of files) {
  let req
  try { req = JSON.parse(fs.readFileSync(f, 'utf-8')) } catch { continue }
  if (!Array.isArray(req.nodes) || !Array.isArray(req.edges)) { console.log(`⏭️ 跳过（非 req 结构）: ${path.basename(f)}`); continue }
  const base = f.replace(/\.json$/, '')
  try {
    const r = processReq(req, base)
    results.push(r)
    console.log(`${r.pass ? '✅' : '❌'} ${r.title || path.basename(f)} — ${r.summary}`)
  } catch (e) {
    results.push({ name: path.basename(f), title: path.basename(f), pass: false, summary: '异常: ' + e.message.slice(0, 80) })
    console.log(`❌ ${path.basename(f)} — 异常: ${e.message.slice(0, 100)}`)
  }
}

const passCount = results.filter(r => r.pass).length
const total = results.length
const batchMd = `# 批量出图汇总报告\n\n- **时间**：${new Date().toLocaleString('zh-CN')}\n- **总数**：${total}，**通过**：${passCount}（${Math.round(passCount / total * 100)}%）\n\n| 图 | 模式 | 节点/边 | 结论 |\n|---|---|---|---|\n${results.map(r => `| ${r.title || r.name} | — | ${r.nodes ?? '-'}/${r.edges ?? '-'} | ${r.pass ? '✅' : '❌ ' + r.summary} |`).join('\n')}\n`
fs.writeFileSync('batch-report.md', batchMd, 'utf-8')
fs.writeFileSync('batch-report.json', JSON.stringify(results, null, 2), 'utf-8')
console.log(`\n📊 汇总: ${passCount}/${total} 通过 → batch-report.md`)
