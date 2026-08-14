// ============================================================
// req-util.mjs — 需求 JSON（§4.1 输入协议）→ Mermaid 源码
// 供 agent-orchestrator / agent-batch / nlp-model 复用
// ============================================================

export function reqToMermaid(req) {
  let s = `flowchart TD\n`
  if (req.lanes) {
    req.lanes.forEach((l, i) => {
      s += `    subgraph L${i}["${l.dept}"]\n        direction LR\n`
      req.nodes.filter(n => n.dept === l.dept).forEach(n => {
        const label = n.role && n.role !== l.dept ? n.role + '：' + n.action : n.action
        const shape = n.shape === 'diamond' ? '{' + label + '}'
          : n.shape === 'start' || n.shape === 'end' ? '([' + label + '])'
          : n.shape === 'data' ? '[(' + label + ')]'
          : '[' + label + ']'
        s += `        ${n.id}${shape}\n`
      })
      s += `    end\n`
    })
  } else {
    req.nodes.forEach(n => {
      const label = n.role ? n.role + '：' + n.action : n.action
      const shape = n.shape === 'diamond' ? '{' + label + '}'
        : n.shape === 'start' || n.shape === 'end' ? '([' + label + '])'
        : n.shape === 'data' ? '[(' + label + ')]'
        : '[' + label + ']'
      s += `    ${n.id}${shape}\n`
    })
  }
  req.edges.forEach(e => {
    s += `    ${e.from} ${e.reverse ? '-.->' : '-->'}${e.label ? '|' + e.label + '|' : ''} ${e.to}\n`
  })
  return s
}
