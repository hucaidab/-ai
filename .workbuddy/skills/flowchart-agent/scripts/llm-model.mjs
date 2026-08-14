// ============================================================
// llm-model.mjs — 自由自然语言 → req.json（V4 M3）
// 接入方式：本地配置文件 llm.config.json（base_url/api_key/model），
//           环境变量 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 兜底
// 降级链：LLM 失败/未配置 → nlp-model（DSL）→ template-finder（模板）
// 用法: node llm-model.mjs "画一个采购到付款流程，涉及采购员、采购经理、
//       供应商、仓库、质检、应付会计、出纳，要体现审批驳回和三单匹配"
//       [--out req.json] [--force-llm]
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { modelFromText } from './nlp-model.mjs'
import { findTemplate, applyOverrides } from './template-finder.mjs'

export function loadLLMConfig() {
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'llm.config.json'), 'utf-8')) } catch { /* 无配置 */ }
  // 团队规范：环境变量为权威来源（不落盘、CI 友好、每人各自配置）；
  // llm.config.json 仅作本机临时兜底（已被 .gitignore 忽略，禁止提交）
  return {
    base_url: (process.env.LLM_BASE_URL || cfg.base_url || 'https://api.deepseek.com').replace(/\/+$/, ''),
    api_key: process.env.LLM_API_KEY || cfg.api_key || '',
    model: process.env.LLM_MODEL || cfg.model || 'deepseek-chat',
  }
}

// ---------- 系统提示词（JSON Schema + few-shot） ----------
const SYSTEM = `你是业务流程建模专家。把用户的自然语言需求转换为结构化 JSON，用于绘制流程图。
必须严格输出 JSON（不要任何多余文字），结构如下：
{
  "type": "flowchart",
  "title": "简短标题",
  "lanes": [ { "dept": "部门/角色名", "roles": ["岗位1","岗位2"] } ],
  "nodes": [
    { "id": "N1", "dept": "所属部门", "role": "岗位", "action": "动作描述", "shape": "start|end|rect|diamond|data" }
  ],
  "edges": [
    { "from": "N1", "to": "N2", "label": "边标签(可为空)", "reverse": false }
  ]
}
规则：
1. 开始节点 1 个（shape=start），结束节点 1 个（shape=end），动作以"开始："开头/含"结束"字样。
2. 判断/审批类节点用 shape=diamond（动作通常以？结尾），其每个出口边必须带标签（如"通过/驳回"）。
3. 驳回、退货、退回、不通过、逾期、催收等"逆向/异常"流转，其边 reverse=true（渲染为虚线）。
4. 每个节点必须属于某个 dept（lanes 里要有该部门），role 是该部门的岗位。
5. 单图节点 ≤30；若超过，明确告诉用户"建议拆分为多张图"并在 title 中标注。
6. 所有 id 用 N1、N2… 递增。
示例（采购审批，仅演示格式）：
{
  "type": "flowchart", "title": "采购审批流程",
  "lanes": [ { "dept": "采购部", "roles": ["采购员","采购经理"] } ],
  "nodes": [
    { "id": "N1", "dept": "采购部", "role": "采购员", "action": "开始：提交采购申请", "shape": "start" },
    { "id": "N2", "dept": "采购部", "role": "采购员", "action": "填写申请单", "shape": "rect" },
    { "id": "N3", "dept": "采购部", "role": "采购经理", "action": "审批通过?", "shape": "diamond" },
    { "id": "N4", "dept": "采购部", "role": "采购员", "action": "结束：申请完成", "shape": "end" }
  ],
  "edges": [
    { "from": "N1", "to": "N2", "label": "", "reverse": false },
    { "from": "N2", "to": "N3", "label": "提交", "reverse": false },
    { "from": "N3", "to": "N4", "label": "通过", "reverse": false },
    { "from": "N3", "to": "N2", "label": "驳回", "reverse": true }
  ]
}`

// ---------- LLM 调用（OpenAI 兼容） ----------
async function callLLM(text, cfg) {
  const url = cfg.base_url + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.api_key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: '需求：' + text },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM 返回空内容')
  const start = content.indexOf('{'), end = content.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('LLM 输出非 JSON')
  return JSON.parse(content.slice(start, end + 1))
}

// ---------- Schema 校验与修复 ----------
export function repairSchema(req) {
  if (!req || typeof req !== 'object') return null
  if (!Array.isArray(req.nodes) || !Array.isArray(req.edges)) return null
  const SHAPES = ['start', 'end', 'rect', 'diamond', 'data', 'subroutine']
  const seen = new Set()
  const lanes = Array.isArray(req.lanes) ? req.lanes : []
  req.nodes.forEach((n, i) => {
    if (!n.id) n.id = 'N' + (i + 1)
    if (seen.has(n.id)) n.id = 'N' + (i + 1) + '_' + i
    seen.add(n.id)
    if (!SHAPES.includes(n.shape)) n.shape = 'rect'
    if (!n.action) n.action = n.id
    if (!n.dept) n.dept = n.role || '其他'
    if (!n.role) n.role = n.dept
    if (!lanes.some(l => l.dept === n.dept)) lanes.push({ dept: n.dept, roles: [n.role] })
    else if (!lanes.find(l => l.dept === n.dept).roles.includes(n.role)) lanes.find(l => l.dept === n.dept).roles.push(n.role)
  })
  req.lanes = lanes
  req.edges.forEach(e => {
    if (e.reverse === undefined) e.reverse = false
    if (!e.label) e.label = ''
  })
  return req
}

// ---------- 主入口（含降级链） ----------
export async function llmModel(text, cfg) {
  const config = cfg || loadLLMConfig()
  // 1. LLM（配置了 key 才调用）
  if (config.api_key) {
    try {
      const raw = await callLLM(text, config)
      const req = repairSchema(raw)
      if (req) return { req, source: 'llm' }
      console.warn('⚠️ LLM 输出未通过 schema 校验')
    } catch (e) {
      console.warn('⚠️ LLM 调用失败，降级:', e.message.slice(0, 100))
    }
  } else {
    console.log('ℹ️ 未配置 LLM_API_KEY，走规则版（团队配置见 LLM_CONFIG.md：设置环境变量后自动启用 LLM）')
  }
  // 2. 降级：DSL 建模
  const dsl = modelFromText(text)
  if (dsl.nodes.length) return { req: dsl, source: 'dsl' }
  // 3. 降级：模板匹配
  const hit = findTemplate(text)
  if (hit) return { req: applyOverrides(hit.template, text), source: 'template:' + hit.name }
  return { req: null, source: 'none' }
}

// ---------- CLI ----------
if (process.argv[1] && process.argv[1].endsWith('llm-model.mjs')) {
  const text = process.argv[2]
  const outIdx = process.argv.indexOf('--out')
  const outFile = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : null
  const forceLLM = process.argv.includes('--force-llm')
  if (!text) { console.error('用法: node llm-model.mjs "自然语言需求" [--out req.json]'); process.exit(1) }
  const cfg = loadLLMConfig()
  if (forceLLM && !cfg.api_key) { console.error('❌ --force-llm 但未配置 api_key（llm.config.json）'); process.exit(1) }
  const result = await llmModel(text, cfg)
  if (!result.req) { console.error('❌ 建模失败：无法识别需求，请补充部门/角色/流程描述'); process.exit(1) }
  const label = result.source.startsWith('template') ? result.source : result.source
  console.log(`✅ 建模完成（来源: ${result.source}）：${result.req.title}，节点 ${result.req.nodes.length}，边 ${result.req.edges.length}，泳道 ${(result.req.lanes || []).length}`)
  if (outFile) { fs.writeFileSync(outFile, JSON.stringify(result.req, null, 2), 'utf-8'); console.log(`   已写入: ${outFile}`) }
  else console.log(JSON.stringify(result.req, null, 2))
}
