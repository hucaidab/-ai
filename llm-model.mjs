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

// ---------- 质量自检（M5：LLM 输出鲁棒性） ----------
// 返回 { ok, errors: [], warnings: [] }
// errors = 硬伤（缺起止/判断无标签）→ 触发 autoFix + 重试；warnings = 软问题不阻塞
export function selfCheck(req) {
  const errors = [], warnings = []
  if (!req || !Array.isArray(req.nodes)) return { ok: false, errors: ['结构无效'], warnings: [] }
  if (!req.nodes.some(n => n.shape === 'start')) errors.push('缺少开始节点')
  if (!req.nodes.some(n => n.shape === 'end')) errors.push('缺少结束节点')
  if (req.nodes.length < 4) warnings.push('节点数过少（' + req.nodes.length + '），需求可能描述不完整')
  if (req.nodes.length > 30) warnings.push('节点数 ' + req.nodes.length + ' > 30，建议拆图（已自动处理）')
  const idSet = new Set(req.nodes.map(n => n.id))
  req.nodes.filter(n => n.shape === 'diamond').forEach(d => {
    const outs = req.edges.filter(e => e.from === d.id && idSet.has(e.to))
    if (outs.length < 2) errors.push('判断节点「' + d.action + '」只有 ' + outs.length + ' 个出口（需 ≥2 且带标签）')
    else if (outs.some(e => !e.label)) errors.push('判断节点「' + d.action + '」有未带标签的出口')
  })
  const connected = new Set()
  req.edges.forEach(e => { connected.add(e.from); connected.add(e.to) })
  req.nodes.filter(n => n.shape !== 'start' && n.shape !== 'end').forEach(n => {
    if (!connected.has(n.id)) warnings.push('节点「' + n.action + '」未与任何节点相连')
  })
  return { ok: errors.length === 0, errors, warnings }
}

// ---------- 规则自动修复 ----------
// 修复缺起止/判断出口标签/孤立节点，返回 { req, fixed: [说明] }
export function autoFix(req) {
  const fixed = []
  const idSet = new Set(req.nodes.map(n => n.id))
  const hasStart = req.nodes.some(n => n.shape === 'start')
  const hasEnd = req.nodes.some(n => n.shape === 'end')
  const inDeg = {}, outDeg = {}
  req.nodes.forEach(n => { inDeg[n.id] = 0; outDeg[n.id] = 0 })
  req.edges.forEach(e => {
    if (idSet.has(e.from) && idSet.has(e.to)) { outDeg[e.from]++; inDeg[e.to]++ }
  })
  const firstNode = req.nodes.find(n => inDeg[n.id] === 0 && n.shape !== 'start' && n.shape !== 'end') || req.nodes[0]
  const lastNode = req.nodes.find(n => outDeg[n.id] === 0 && n.shape !== 'start' && n.shape !== 'end') || req.nodes[req.nodes.length - 1]
  if (!hasStart && firstNode) {
    const sn = { id: 'START', dept: firstNode.dept, role: firstNode.role, action: '开始：' + (req.title || '').replace(/流程$/, '') + '启动', shape: 'start' }
    req.nodes.unshift(sn)
    if (!req.edges.some(e => e.from === 'START')) req.edges.push({ from: 'START', to: firstNode.id, label: '', reverse: false })
    fixed.push('补充开始节点')
  }
  if (!hasEnd && lastNode) {
    const en = { id: 'END', dept: lastNode.dept, role: lastNode.role, action: '结束：' + (lastNode.action || '完成'), shape: 'end' }
    req.nodes.push(en)
    if (!req.edges.some(e => e.to === 'END')) req.edges.push({ from: lastNode.id, to: 'END', label: '', reverse: false })
    fixed.push('补充结束节点')
  }
  // 判断节点：出口补标签 / 补驳回回边
  req.nodes.filter(n => n.shape === 'diamond').forEach(d => {
    const outs = req.edges.filter(e => e.from === d.id && idSet.has(e.to))
    let i = 0
    outs.forEach(e => { if (!e.label) { e.label = i++ === 0 ? '通过' : '驳回'; fixed.push('判断「' + d.action + '」出口补标签 ' + e.label) } })
    if (outs.length <= 1) {
      const back = req.edges.find(e => e.to === d.id)
      if (back && !req.edges.some(e => e.from === d.id && e.to === back.from)) {
        req.edges.push({ from: d.id, to: back.from, label: '驳回', reverse: true })
        fixed.push('判断「' + d.action + '」补驳回回边')
      }
    }
  })
  // 孤立节点串联
  const connected = new Set()
  req.edges.forEach(e => { connected.add(e.from); connected.add(e.to) })
  let prev = req.nodes.find(n => n.shape === 'start')?.id || req.nodes[0]?.id
  req.nodes.forEach(n => {
    if (n.shape === 'start') { prev = n.id; return }
    if (n.id === 'END') return
    if (!connected.has(n.id)) {
      if (prev) req.edges.push({ from: prev, to: n.id, label: '', reverse: false })
      if (!req.edges.some(e => e.to === 'END' && e.from === n.id)) req.edges.push({ from: n.id, to: 'END', label: '', reverse: false })
      fixed.push('孤立节点「' + n.action + '」已串联')
    }
    prev = n.id
  })
  return { req, fixed }
}

// ---------- 主入口（含降级链 + 自检/修复/重试） ----------
export async function llmModel(text, cfg) {
  const config = cfg || loadLLMConfig()
  // 1. LLM（配置了 key 才调用）
  if (config.api_key) {
    try {
      const raw = await callLLM(text, config)
      const req = repairSchema(raw)
      if (req) {
        let chk = selfCheck(req)
        if (!chk.ok) {
          const fx = autoFix(req)
          chk = selfCheck(fx.req)
          if (fx.fixed.length) console.log('🔧 规则自动修复：' + fx.fixed.join('、'))
          if (!chk.ok) {
            // 重试一次：追加更严格指令
            console.log('🔄 LLM 输出自检未通过（' + chk.errors.join('；') + '），重试一次')
            try {
              const raw2 = await callLLM(text + '\n（重要：上次输出不合格。必须包含 1 个 shape=start 的开始节点和 1 个 shape=end 的结束节点；每个 shape=diamond 判断节点必须带 ≥2 个带标签的出口边）', config)
              const req2 = repairSchema(raw2)
              if (req2) {
                const chk2 = selfCheck(req2)
                if (!chk2.ok) {
                  const fx2 = autoFix(req2)
                  if (fx2.fixed.length) console.log('🔧 重试后规则修复：' + fx2.fixed.join('、'))
                  const chk3 = selfCheck(fx2.req)
                  if (chk3.ok) return { req: fx2.req, source: 'llm' }
                } else return { req: req2, source: 'llm' }
              }
            } catch (e) { console.warn('⚠️ LLM 重试失败:', e.message.slice(0, 80)) }
          }
        }
        if (chk.ok) return { req, source: 'llm' }
        console.warn('⚠️ LLM 输出自检最终未通过（' + chk.errors.join('；') + '），降级')
      } else {
        console.warn('⚠️ LLM 输出未通过 schema 校验')
      }
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
