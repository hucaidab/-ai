// ============================================================
// req-util.mjs — 需求 JSON（§4.1 输入协议）→ Mermaid 源码
// 供 agent-orchestrator / agent-batch / nlp-model 复用
// ============================================================

export function reqToMermaid(req) {
  let s = `flowchart TD\n`
  // 节点形状（diamond/stadium/data/rect）——兜底分支也复用
  const shapeOf = (n, roleLabel) => {
    const label = roleLabel && roleLabel !== n.dept ? roleLabel + '：' + n.action : n.action
    return n.shape === 'diamond' ? '{' + label + '}'
      : n.shape === 'start' || n.shape === 'end' ? '([' + label + '])'
      : n.shape === 'data' ? '[(' + label + ')]'
      : '[' + label + ']'
  }
  if (req.lanes) {
    const laneDepts = new Set(req.lanes.map(l => l.dept))
    req.lanes.forEach((l, i) => {
      s += `    subgraph L${i}["${l.dept}"]\n        direction LR\n`
      req.nodes.filter(n => n.dept === l.dept).forEach(n => {
        s += `        ${n.id}${shapeOf(n, n.role)}\n`
      })
      s += `    end\n`
    })
    // 兜底：dept 不在任何 lane 的节点（如编辑器 addNode 的'其他'）必须输出，否则渲染丢失（质检抓出）
    req.nodes.filter(n => !laneDepts.has(n.dept)).forEach(n => {
      s += `    ${n.id}${shapeOf(n, n.role)}\n`
    })
  } else {
    req.nodes.forEach(n => {
      s += `    ${n.id}${shapeOf(n, n.role)}\n`
    })
  }
  req.edges.forEach(e => {
    s += `    ${e.from} ${e.reverse ? '-.->' : '-->'}${e.label ? '|' + e.label + '|' : ''} ${e.to}\n`
  })
  return s
}
