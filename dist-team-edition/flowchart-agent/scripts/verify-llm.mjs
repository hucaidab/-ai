// ============================================================
// verify-llm.mjs — LLM 自然语言建模验收脚本（M3 验收标准）
// 5 个自然语言用例 → 建模 → 渲染 → 10 项自动验收 → 汇总报告
// 有 LLM_API_KEY：走真实 LLM；无 key：自动降级（DSL/模板）验证链路
// 用法: node verify-llm.mjs [--out-dir 目录]
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { llmModel } from './llm-model.mjs'
import { splitAndRender } from './split-graph.mjs'

const outDir = process.argv.includes('--out-dir')
  ? process.argv[process.argv.indexOf('--out-dir') + 1]
  : 'llm-verify-out'
fs.mkdirSync(outDir, { recursive: true })

const CASES = [
  { name: 'P2P 采购到付款', text: '画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检、应付会计、出纳，要体现审批驳回和三单匹配' },
  { name: 'OTC 销售订单', text: '销售订单流程：客户发起订单，销售员创建销售订单，销售经理审批大额订单，信用专员审核信用，仓管员拣货发货，客户收货验收，应收会计开票对账，出纳收款核销' },
  { name: '员工入职', text: '员工入职流程：候选人投递简历，HR 初筛并安排面试，用人部门复试，HR 发放 offer，候选人确认入职，IT 开通账号权限，财务录入薪酬档案' },
  { name: '费用报销', text: '费用报销流程：员工提交报销单，部门经理审批，财务审核票据合规性，出纳打款，员工确认收款' },
  { name: '请假审批', text: '请假审批流程：员工提交请假申请，直属经理审批，HR 核对假期额度并备案' },
]

// 质量自检（建模层）
function qualityCheck(req) {
  const issues = []
  if (!req.nodes || req.nodes.length < 4) issues.push('节点过少')
  if (!req.nodes.some(n => n.shape === 'start')) issues.push('缺开始')
  if (!req.nodes.some(n => n.shape === 'end')) issues.push('缺结束')
  if (!req.lanes || req.lanes.length < 1) issues.push('缺泳道')
  const diamonds = (req.nodes || []).filter(n => n.shape === 'diamond')
  diamonds.forEach(d => {
    const outEdges = (req.edges || []).filter(e => e.from === d.id)
    if (outEdges.length < 2 || !outEdges.every(e => e.label)) issues.push(`判断「${d.action}」出口标签不完整`)
  })
  return issues
}

const results = []
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]
  console.log(`\n▶ 用例 ${i + 1}/${CASES.length}：${c.name}`)
  try {
    const { req, source } = await llmModel(c.text)
    if (!req) { results.push({ ...c, ok: false, source, detail: '建模失败' }); console.log('  ❌ 建模失败'); continue }
    const qIssues = qualityCheck(req)
    // 渲染 + 验收
    const outBase = path.join(outDir, `case${i + 1}`)
    const r = splitAndRender(req, outBase, 30)
    const pass = qIssues.length === 0 && r.pass
    results.push({ ...c, ok: pass, source, nodes: req.nodes.length, edges: (req.edges || []).length, qIssues, render: r.pass ? '✅' : r.main?.summary })
    console.log(`  ${pass ? '✅' : '❌'} 来源=${source}，节点 ${req.nodes.length}，质量${qIssues.length ? '⚠️ ' + qIssues.join('、') : 'OK'}，渲染${r.pass ? '✅' : '❌ ' + (r.main?.summary || '')}`)
  } catch (e) {
    results.push({ ...c, ok: false, source: 'error', detail: e.message.slice(0, 120) })
    console.log('  ❌ 异常: ' + e.message.slice(0, 120))
  }
}

// 汇总报告
const passCount = results.filter(r => r.ok).length
const md = `# LLM 自然语言建模验收报告

- **时间**：${new Date().toLocaleString('zh-CN')}
- **结论**：${passCount}/${results.length} 通过
${process.env.LLM_API_KEY ? '- **模式**：真实 LLM（环境变量已配置）' : '- **模式**：降级链（未配置 LLM_API_KEY，走 DSL/模板）'}

| 用例 | 来源 | 节点 | 质量自检 | 渲染验收 |
|---|---|---|---|---|
${results.map(r => `| ${r.name} | ${r.source} | ${r.nodes ?? '-'} | ${r.qIssues?.length ? '⚠️ ' + r.qIssues.join('、') : '✅'} | ${r.render ?? r.detail ?? '❌'} |`).join('\n')}
`
fs.writeFileSync(path.join(outDir, 'verify-report.md'), md, 'utf-8')
console.log(`\n📊 验收汇总: ${passCount}/${results.length} 通过 → ${outDir}/verify-report.md`)
if (!process.env.LLM_API_KEY) {
  console.log('💡 提示: 配置环境变量后复跑真实验证 → setx LLM_API_KEY "sk-xxx"（重开终端）→ node verify-llm.mjs')
}
