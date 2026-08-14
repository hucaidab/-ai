// ============================================================
// template-finder.mjs — 知识库模板匹配器（V4 M1）
// 输入需求文本 → 按触发词打分 → 返回最佳模板（可带变量覆盖）
// 用法:
//   node template-finder.mjs "画一个采购到付款的流程图"            # 打印最佳模板名
//   node template-finder.mjs "采购流程" --out req.json            # 输出模板到文件
//   node template-finder.mjs "报销流程，出纳改叫资金专员" --out req.json  # 变量覆盖
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const TEMPLATE_DIR = path.join(import.meta.dirname, 'templates')

export function findTemplate(text, templatesDir = TEMPLATE_DIR) {
  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json')).sort()
  let best = null, bestScore = 0
  // 需求文本开头（前 30 字符）通常最可能指示流程类型 → 加权
  const head = text.slice(0, 30)
  for (const f of files) {
    let tpl
    try { tpl = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf-8')) } catch { continue }
    const triggers = (tpl.meta && tpl.meta.triggers) || []
    const score = triggers.filter(t => text.includes(t)).length + triggers.filter(t => head.includes(t)).length * 2
    if (score > bestScore) { best = { name: f, template: tpl, score }; bestScore = score }
  }
  return best
}

// 变量覆盖：文本中的 "X 改叫 Y" / "X改为Y" / "角色：X=Y" 形式
export function applyOverrides(template, text) {
  const t = JSON.parse(JSON.stringify(template))
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9]+?)\s*(?:改叫|改为|改成|换成|替换为|->|→)\s*([\u4e00-\u9fa5A-Za-z0-9]+)/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(text)) !== null) {
      const [from, to] = [m[1], m[2]]
      t.nodes.forEach(n => { if (n.role === from) n.role = to; if (n.action === from) n.action = to })
      t.lanes.forEach(l => {
        l.roles = l.roles.map(r => r === from ? to : r)
        if (l.dept === from) l.dept = to
      })
    }
  }
  return t
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('template-finder.mjs')) {
  const text = process.argv[2] || ''
  const outIdx = process.argv.indexOf('--out')
  const outFile = outIdx >= 0 && process.argv[outIdx + 1] ? process.argv[outIdx + 1] : null
  if (!text) { console.error('用法: node template-finder.mjs "需求文本" [--out req.json]'); process.exit(1) }
  const hit = findTemplate(text)
  if (!hit) { console.error('❌ 未匹配到模板，触发词：采购/销售/入职/报销/请假/登录/领料/退货'); process.exit(1) }
  if (outFile) {
    const tpl = applyOverrides(hit.template, text)
    fs.writeFileSync(outFile, JSON.stringify(tpl, null, 2), 'utf-8')
    console.log(`✅ 模板命中: ${hit.name}（得分 ${hit.score}）→ ${outFile}`)
    console.log(`   标题: ${tpl.title}，节点 ${tpl.nodes.length}，泳道 ${tpl.lanes.length}`)
  } else {
    console.log(`模板命中: ${hit.name}（得分 ${hit.score}）· ${hit.template.title}`)
  }
}
