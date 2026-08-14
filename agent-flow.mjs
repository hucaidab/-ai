// ============================================================
// agent-flow.mjs — 单命令流程图智能体（V4 M4 整合 + M5 增强）
// 一句话 → 建模 → 渲染/自动拆图 → 自动验收 → 交付 + 预览提示
// 用法:
//   node agent-flow.mjs "画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检、应付会计、出纳，要体现审批驳回和三单匹配"
//   node agent-flow.mjs "销售订单流程" --out sales
//   node agent-flow.mjs "从 req.json 直接出图" --req req.json --out base
//   node agent-flow.mjs "基于现有图改" --edit req.json "把驳回改成标红虚线"   ← M5 对话式编辑
//   node agent-flow.mjs "..." --mmd --pdf                                     ← M5 多格式导出
// 依赖: llm-model（LLM/DSL/模板降级链）→ split-graph（>30 自动拆图）→ lib-export（mmd/pdf）
// ============================================================
import fs from 'node:fs'
import { llmModel } from './llm-model.mjs'
import { splitAndRender, renderOne } from './split-graph.mjs'
import { exportMermaid, svgToPdf } from './lib-export.mjs'

const args = process.argv.slice(2)
const getOpt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const outBase = getOpt('--out', 'flow')
const maxNodes = parseInt(getOpt('--max', '30'), 10)
const reqFile = getOpt('--req', '')
const editIdx = args.indexOf('--edit')
const editFile = editIdx >= 0 && args[editIdx + 1] ? args[editIdx + 1] : ''
const editText = editIdx >= 0 && args[editIdx + 2] ? args[editIdx + 2] : ''
const wantMmd = args.includes('--mmd')
const wantPdf = args.includes('--pdf')
const text = (editFile || reqFile) ? '' : args[0]

// ---------- 1. 建模 ----------
let req, source = ''
if (reqFile) {
  req = JSON.parse(fs.readFileSync(reqFile, 'utf-8'))
  source = 'req.json'
} else if (editFile) {
  // M5 对话式编辑：基于原图上下文 + 修改描述重新建模
  if (!editText) { console.error('用法: node agent-flow.mjs --edit req.json "修改描述"'); process.exit(1) }
  const base = JSON.parse(fs.readFileSync(editFile, 'utf-8'))
  const summary = '现有流程图标题：' + (base.title || '未命名') + '\n' +
    '现有节点：' + base.nodes.map(n => n.id + '(' + (n.dept || '') + '/' + (n.role || '') + '/' + (n.action || '') + '/' + (n.shape || 'rect') + ')').join('、') + '\n' +
    '现有边：' + base.edges.map(e => e.from + '→' + e.to + (e.label ? '(' + e.label + ')' : '') + (e.reverse ? '[逆向]' : '')).join('、')
  console.log('✏️ 编辑模式：基于 ' + editFile + ' 应用修改「' + editText + '」')
  const r = await llmModel(summary + '\n用户修改要求：' + editText + '\n（严格按修改要求执行：要求删除/去掉的节点和边必须移除，不能保留；要求新增的环节必须出现；其余原有流程骨架保持不变）')
  if (!r.req) { console.error('❌ 编辑建模失败'); process.exit(1) }
  req = r.req
  source = 'edit:' + r.source
} else {
  if (!text) { console.error('用法: node agent-flow.mjs "自然语言需求" [--out 前缀] [--req req.json] [--edit req.json 修改] [--mmd] [--pdf]'); process.exit(1) }
  const r = await llmModel(text)
  if (!r.req) { console.error('❌ 建模失败'); process.exit(1) }
  req = r.req
  source = r.source
}
console.log(`📋 需求建模完成（${source}）：${req.title || '(未命名)'}，${req.nodes.length} 节点，${(req.edges || []).length} 边，${(req.lanes || []).length} 泳道`)

// ---------- 2. 渲染 / 自动拆图 ----------
const result = splitAndRender(req, outBase, maxNodes)

// ---------- 2.5 多格式导出（M5） ----------
if (wantMmd) {
  fs.writeFileSync(outBase + '.mmd', exportMermaid(req), 'utf-8')
  console.log(`  📄 Mermaid 源码 → ${outBase}.mmd`)
}
if (wantPdf) {
  const mainSvg = result.subs.length ? outBase + '-main.svg' : outBase + '.svg'
  try {
    const pdf = svgToPdf(fs.readFileSync(mainSvg, 'utf-8'))
    const pdfFile = outBase + (result.subs.length ? '-main.pdf' : '.pdf')
    fs.writeFileSync(pdfFile, pdf)
    console.log(`  📕 PDF → ${pdfFile}`)
  } catch (e) { console.warn('  ⚠️ PDF 导出失败:', e.message.slice(0, 80)) }
}

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
