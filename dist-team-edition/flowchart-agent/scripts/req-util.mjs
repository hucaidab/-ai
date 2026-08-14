// ============================================================
// req-util.mjs — 需求 JSON（§4.1 输入协议）→ Mermaid 源码
// 供 agent-orchestrator / agent-batch / nlp-model 复用
// ============================================================

export function reqToMermaid(req) {
  let s = `flowchart TD\n`
  // 节点形状（diamond/stadium/cylinder/subroutine/data——兜底分支也复用）
  // parse-flow 映射：{}=diamond, ([])=stadium, [( )]=cylinder, [[ ]]=subroutine
  const shapeOf = (n, roleLabel) => {
    const label = roleLabel && roleLabel !== n.dept ? roleLabel + '：' + n.action : n.action
    return n.shape === 'diamond' ? '{' + label + '}'
      : n.shape === 'stadium' || n.shape === 'start' || n.shape === 'end' ? '([' + label + '])'
      : n.shape === 'data' || n.shape === 'cylinder' ? '[(' + label + ')]'
      : n.shape === 'subroutine' ? '[[' + label + ']]'
      : '[' + label + ']'
  }
  // 递归输出泳道树（多层嵌套 subgraph；空泳道也输出——容器式保留显示）
  // 返回已输出的 dept 集合（避免兜底段重复）
  const allDepts = new Set()
  const emitLane = (lane, depth, idx) => {
    const id = 'L' + depth + '_' + idx
    const pad = '    '.repeat(depth + 1)
    allDepts.add(lane.dept)
    s += `${pad}subgraph ${id}["${lane.dept}"]\n${pad}    direction LR\n`
    if (lane.children && lane.children.length) {
      lane.children.forEach((c, j) => emitLane(c, depth + 1, j))
    }
    // 本层节点（dept 精确匹配当前泳道，子泳道节点已在递归中输出）
    req.nodes.filter(n => n.dept === lane.dept && !(lane.children || []).some(c => c.dept === n.dept)).forEach(n => {
      s += `${pad}    ${n.id}${shapeOf(n, n.role)}\n`
    })
    s += `${pad}end\n`
  }
  if (req.lanes) {
    req.lanes.forEach((l, i) => emitLane(l, 0, i))
    // 兜底：dept 不在任何 lane 的节点（如编辑器 addNode 的'其他'）必须输出，否则渲染丢失（质检抓出）
    req.nodes.filter(n => !allDepts.has(n.dept)).forEach(n => {
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
