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
import { spawn, exec } from 'node:child_process'
import http from 'node:http'
import { llmModel } from './llm-model.mjs'
import { splitAndRender, renderOne } from './split-graph.mjs'
import { exportMermaid, svgToPdf } from './lib-export.mjs'

// ---------- 生成后自动打开在线编辑器（生成即编辑，一步到位） ----------
// 用户反馈：生成后只给提示很多人不知道还能在线编辑 → 自动拉起服务 + 打开浏览器到编辑器
async function openEditor(file) {
  const url = 'http://localhost:8080/editor?file=' + encodeURIComponent(file)
  const alive = await new Promise(res => {
    const p = http.get({ host: '127.0.0.1', port: 8080, path: '/', timeout: 1500 }, r => { r.destroy(); res(true) })
    p.on('error', () => res(false))
    p.on('timeout', () => { p.destroy(); res(false) })
  })
  if (!alive) {
    console.log('  🚀 启动本地预览服务...')
    try {
      const child = spawn(process.execPath, ['preview-server.mjs', '8080', '.'], { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (e) { console.warn('  ⚠️ 服务启动失败（可手动执行 node preview-server.mjs 8080 .）：' + (e.message || e)) }
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400))
      const ok = await new Promise(res => {
        const q = http.get({ host: '127.0.0.1', port: 8080, path: '/', timeout: 800 }, r2 => { r2.destroy(); res(true) })
        q.on('error', () => res(false))
        q.on('timeout', () => { q.destroy(); res(false) })
      })
      if (ok) break
    }
  }
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  exec(cmd, () => {}) // 打开系统默认浏览器
  console.log(`  🖥 已自动打开在线编辑器 → ${url}`)
  console.log(`  💡 定稿方式：在编辑器里调整后点「💾 保存」→ 覆盖更新 ${file}（自动 12 项验收）`)
}

// ---------- P2：全局错误兜底（未捕获异常 → 友好提示而非崩溃堆栈） ----------
process.on('uncaughtException', e => {
  console.error('😅 出错了：' + (e.message || e))
  console.error('   这是异常情况，请把上面这行发给维护者排查（附带操作步骤更容易定位）')
  process.exit(1)
})
process.on('unhandledRejection', e => {
  console.error('😅 出错了：' + (e && e.message ? e.message : e))
  console.error('   这是异常情况，请把上面这行发给维护者排查')
  process.exit(1)
})

const args = process.argv.slice(2)
const getOpt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def }
const outBase = getOpt('--out', 'flow')
const maxNodes = parseInt(getOpt('--max', '30'), 10)
const theme = getOpt('--theme', 'github-light')
const reqFile = getOpt('--req', '')
const editIdx = args.indexOf('--edit')
const editNext = editIdx >= 0 ? args[editIdx + 1] : ''
const editFile = editIdx >= 0 && editNext && editNext.endsWith('.json') ? editNext : ''
const editText = editIdx >= 0 ? args[editIdx + (editFile ? 2 : 1)] || '' : ''
const wantMmd = args.includes('--mmd')
const wantPdf = args.includes('--pdf')
const text = (editFile || reqFile) ? '' : args[0]

// ---------- 1. 建模 ----------
let req, source = ''
if (reqFile) {
  req = JSON.parse(fs.readFileSync(reqFile, 'utf-8'))
  source = 'req.json'
} else if (editIdx >= 0) {
  // M5/M6 对话式编辑：自动接续最新一版 req.json（P0 多轮修改）
  let baseFile = editFile
  if (!baseFile) {
    // --edit "修改描述"（不带文件名）→ 自动找最近生成的 req.json
    const candidates = fs.readdirSync('.').filter(f => f.endsWith('.req.json') && !f.includes('.report.') && !f.startsWith('.workbuddy') && !f.startsWith('templates/') && !f.startsWith('llm-verify'))
    if (candidates.length) {
      candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      baseFile = candidates[0]
      console.log('🔗 未指定文件，自动接续最近一版：' + baseFile)
    }
  }
  if (!baseFile) { console.error('❌ 找不到可编辑的 req.json（先出图一次，或用 --edit <文件>）'); process.exit(1) }
  if (!editText) { console.error('用法: node agent-flow.mjs --edit [req.json] "修改描述"'); process.exit(1) }
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf-8'))
  const summary = '现有流程图标题：' + (base.title || '未命名') + '\n' +
    '现有节点：' + base.nodes.map(n => n.id + '(' + (n.dept || '') + '/' + (n.role || '') + '/' + (n.action || '') + '/' + (n.shape || 'rect') + ')').join('、') + '\n' +
    '现有边：' + base.edges.map(e => e.from + '→' + e.to + (e.label ? '(' + e.label + ')' : '') + (e.reverse ? '[逆向]' : '')).join('、')
  console.log('✏️ 编辑模式：基于 ' + baseFile + ' 应用修改「' + editText + '」')
  const r = await llmModel(summary + '\n用户修改要求：' + editText + '\n（严格按修改要求执行：要求删除/去掉的节点和边必须移除；要求新增的环节必须出现；其余原有流程骨架保持不变）')
  if (r.needMore) {
    console.log('📝 修改要求不完整，请补充后再试：')
    r.questions.forEach(q => console.log('   • ' + q))
    process.exit(3)
  }
  if (!r.req) { console.error('❌ 编辑建模失败'); process.exit(1) }
  req = r.req
  source = 'edit:' + r.source
} else {
  if (!text) { console.error('用法: node agent-flow.mjs "自然语言需求" [--out 前缀] [--req req.json] [--edit req.json 修改] [--mmd] [--pdf]'); process.exit(1) }
  const r = await llmModel(text)
  if (r.needMore) {
    console.log('📝 需求信息不完整，请补充后再试：')
    r.questions.forEach(q => console.log('   • ' + q))
    process.exit(3)
  }
  if (!r.req) { console.error('❌ 建模失败'); process.exit(1) }
  req = r.req
  source = r.source
}
console.log(`📋 需求建模完成（${source}）：${req.title || '(未命名)'}，${req.nodes.length} 节点，${(req.edges || []).length} 边，${(req.lanes || []).length} 泳道`)

// ---------- 2. 渲染 / 自动拆图 ----------
const result = splitAndRender(req, outBase, maxNodes, theme)

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
console.log(`  🔄 继续修改: node agent-flow.mjs --edit "${outBase}.req.json" "想改什么"`)

// 生成成功 → 自动打开在线编辑器（定稿闭环：调整 → 保存 → 覆盖更新 req.json）
if (result.pass && !args.includes('--no-open')) {
  await openEditor(outBase + '.req.json')
}

if (!result.pass) process.exit(2)
