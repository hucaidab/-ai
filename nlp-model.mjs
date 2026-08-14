// ============================================================
// nlp-model.mjs — 需求自动建模器（V4：自然语言/DSL → req.json）
// 输入为半结构化中文描述（每行一个元素），支持：
//   # 注释
//   标题: xxx
//   部门: 部门名 (角色1, 角色2)          → lanes
//   开始: 角色.动作                       → start 节点
//   步骤: 角色.动作                       → rect 节点
//   判断: 角色.动作?                      → diamond 节点
//   数据: 角色.动作                       → data 节点
//   结束: 角色.动作                       → end 节点
//   流程: A → B --标签--> C              → edges（--label--> 为边标签）
//   流程: A → B (逆向)                   → 该行全部边标 reverse（虚线）
// 节点引用用动作文本（忽略角色前缀与 ?），自动生成 id
// ============================================================

export function modelFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const req = { type: 'flowchart', title: '', lanes: [], nodes: [], edges: [] }
  const roleDept = new Map()   // role -> dept
  const nodeByAction = new Map() // action(去? ) -> node

  let seq = 0
  const newId = () => 'N' + (++seq)

  function addNode(role, action, shape) {
    const key = action.replace(/\?$/, '').trim()
    if (nodeByAction.has(key)) return nodeByAction.get(key)
    const dept = roleDept.get(role) || (role ? role : '其他')
    // 确保部门存在
    if (!req.lanes.some(l => l.dept === dept)) {
      req.lanes.push({ dept, roles: role ? [role] : [] })
    } else if (role && !req.lanes.find(l => l.dept === dept).roles.includes(role)) {
      req.lanes.find(l => l.dept === dept).roles.push(role)
    }
    const node = { id: newId(), dept, role: role || dept, action, shape }
    req.nodes.push(node)
    nodeByAction.set(key, node)
    return node
  }

  function resolveToken(tok) {
    const key = tok.replace(/\?$/, '').trim()
    if (nodeByAction.has(key)) return nodeByAction.get(key)
    // 去掉可能的前缀"角色."后匹配
    const dot = tok.match(/^(.+?)\.(.+)$/)
    if (dot) {
      const k2 = dot[2].replace(/\?$/, '').trim()
      if (nodeByAction.has(k2)) return nodeByAction.get(k2)
    }
    return null
  }

  for (const line of lines) {
    // 标题
    let m = line.match(/^标题[:：]\s*(.+)$/)
    if (m) { req.title = m[1].trim(); continue }
    // 部门
    m = line.match(/^部门[:：]\s*(.+?)(?:\s*\(([^)]*)\))?$/)
    if (m) {
      const dept = m[1].trim()
      const roles = m[2] ? m[2].split(/[,，、]/).map(r => r.trim()).filter(Boolean) : []
      roles.forEach(r => roleDept.set(r, dept))
      if (!req.lanes.some(l => l.dept === dept)) req.lanes.push({ dept, roles })
      continue
    }
    // 角色行（兼容）：角色: 名字 (部门)
    m = line.match(/^角色[:：]\s*(.+?)(?:\s*\(([^)]*)\))?$/)
    if (m) {
      const role = m[1].trim()
      const dept = (m[2] || '').trim() || role
      roleDept.set(role, dept)
      if (!req.lanes.some(l => l.dept === dept)) req.lanes.push({ dept, roles: [role] })
      else if (!req.lanes.find(l => l.dept === dept).roles.includes(role)) req.lanes.find(l => l.dept === dept).roles.push(role)
      continue
    }
    // 节点行
    m = line.match(/^(开始|步骤|判断|数据|结束)[:：]\s*(.+)$/)
    if (m) {
      const kind = m[1]
      const text = m[2].trim()
      const dm = text.match(/^(.+?)\.(.+)$/)
      const role = dm ? dm[1].trim() : ''
      const action = (dm ? dm[2] : text).trim()
      const shape = kind === '开始' || kind === '结束' ? (kind === '开始' ? 'start' : 'end')
        : kind === '判断' ? 'diamond' : kind === '数据' ? 'data' : 'rect'
      addNode(role, action, shape)
      continue
    }
    // 流程行
    m = line.match(/^(流程|逆向|正向)[:：]\s*(.+)$/)
    if (m) {
      const forceReverse = m[1] === '逆向'
      let body = m[2].trim()
      let lineReverse = forceReverse || /\(逆向\)/.test(body)
      body = body.replace(/\s*\(逆向\)\s*$/, '')
      // --label--> → →|label|（标签属于"进入下一段"的边）
      body = body.replace(/--([^-]+)-->/g, '→|$1|')
      // 按分隔符拆分
      const segs = body.split(/\s*(?:→|->|-->)\s*/).map(s => s.trim()).filter(Boolean)
      for (let i = 1; i < segs.length; i++) {
        const A = resolveToken(segs[i - 1])
        let tok = segs[i]
        let label = ''
        const lm = tok.match(/^\|([^|]+)\|\s*(.+)$/)
        if (lm) { label = lm[1].trim(); tok = lm[2].trim() }
        const B = resolveToken(tok)
        if (!A || !B) continue
        req.edges.push({ from: A.id, to: B.id, label, reverse: lineReverse })
      }
      continue
    }
  }

  return req
}

// CLI：node nlp-model.mjs <in.txt> <out.json>
import fs from 'node:fs'
if (process.argv[1] && process.argv[1].endsWith('nlp-model.mjs')) {
  const [,, inputFile, outputFile] = process.argv
  if (!inputFile) { console.error('用法: node nlp-model.mjs <in.txt> <out.json>'); process.exit(1) }
  const text = fs.readFileSync(inputFile, 'utf-8')
  const req = modelFromText(text)
  const out = outputFile || inputFile.replace(/\.txt$/, '.json')
  fs.writeFileSync(out, JSON.stringify(req, null, 2), 'utf-8')
  console.log(`✅ 建模完成: ${out}（${req.nodes.length} 节点，${req.edges.length} 边，${req.lanes.length} 泳道）`)
}
