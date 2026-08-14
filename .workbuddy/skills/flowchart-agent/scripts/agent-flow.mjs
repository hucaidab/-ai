// ============================================================
// agent-flow.mjs — 单命令流程图智能体（V4 M4 整合）
// 一句话 → 建模 → 渲染/自动拆图 → 自动验收 → 交付 + 预览提示
// 用法:
//   node agent-flow.mjs "画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检、应付会计、出纳，要体现审批驳回和三单匹配"
//   node agent-flow.mjs "销售订单流程" --out sales
//   node agent-flow.mjs "从 req.json 直接出图" --req req.json --out base
// 依赖: llm-model（LLM/DSL/模板降级链）→ split-graph（>30 自动拆图）
// ============================================================
import fs from 'node:fs'
import { llmModel } from './llm-model.mjs'
import { splitAndRender, renderOne } from './split-graph.mjs'

const args = process.argv.slice(2)
const getOpt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const outBase = getOpt('--out', 'flow')
const maxNodes = parseInt(getOpt('--max', '30'), 10)
const reqFile = getOpt('--req', '')
const text = reqFile ? '' : args[0]

// ---------- 1. 建模 ----------
let req, source = ''
if (reqFile) {
  req = JSON.parse(fs.readFileSync(reqFile, 'utf-8'))
  source = 'req.json'
} else {
  if (!text) { console.error('用法: node agent-flow.mjs "自然语言需求" [--out 前缀] [--req req.json]'); process.exit(1) }
  const r = await llmModel(text)
  if (!r.req) { console.error('❌ 建模失败'); process.exit(1) }
  req = r.req
  source = r.source
}
console.log(`📋 需求建模完成（${source}）：${req.title || '(未命名)'}，${req.nodes.length} 节点，${(req.edges || []).length} 边，${(req.lanes || []).length} 泳道`)

// ---------- 2. 渲染 / 自动拆图 ----------
const result = splitAndRender(req, outBase, maxNodes)

// ---------- 3. 汇总 ----------
console.log('')
console.log('═══ 交付汇总 ═══')
if (result.subs.length === 0) {
  console.log(`  ✅ ${req.title} → ${outBase}.svg（${result.main.summary}）`)
} else {
  console.log(`  ✅ 主流程 → ${outBase}-main.svg（${result.main.summary}）`)
  result.subs.forEach((s, i) => console.log(`  ✅ 子流程${i + 1} ${s.name} → ${outBase}-sub${i + 1}.svg（${s.summary}）`))
  console.log(`  📊 图索引 → ${result.indexFile}`)
}
console.log(`  💡 在线预览: node preview-server.mjs 8080 .  →  http://localhost:8080`)

if (!result.pass) process.exit(2)
