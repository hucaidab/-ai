// ============================================================
// parse-flow.mjs — Mermaid flowchart 子集解析器（自研，零依赖）
// 支持：
//   - 头: flowchart TD/LR/TB/BT/RL
//   - 节点: id[..] id{..} id([..]) id[(..)] id[[..]] id((..)) id>..] id[/../] id[\..\]
//   - 边: --> -.-> ==> |label| / -- label --> / -. label .->
//   - subgraph id["title"] ... end (含 direction 覆盖)
//   - classDef 与 :::class 应用
//   - %% 注释
// 输出: { direction, nodes[], edges[], groups[], classDefs{} }
// ============================================================

export function parseFlow(src) {
  const lines = src.split(/\r?\n/).map(l => l.split('%%')[0].trimEnd()).filter(l => l.trim() !== '')
  let direction = 'TD'
  let i = 0
  const nodes = new Map()   // id -> {id,label,shape,cls}
  const edges = []
  const groups = []         // {id,label,nodeIds,direction}
  const classDefs = new Map()
  const stack = []          // 当前 subgraph 栈
  let declaredOrder = []    // 节点声明顺序（用于布局行分配）

  function curGroup() { return stack[stack.length - 1] || null }

  // 形状识别
  function parseShape(text) {
    text = text.trim()
    // 去外层引号
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1)
    const shapes = [
      [/^\(\[(.+)\]\)$/, 'stadium'],
      [/^\[\((.+)\)\]$/, 'cylinder'],
      [/^\[\[(.+)\]\]$/, 'subroutine'],
      [/^\(\(\((.+)\)\)\)$/, 'doublecircle'],
      [/^\{(.+)\}$/, 'diamond'],
      [/^\(\((.+)\)\)$/, 'circle'],
      [/^\((.+)\)$/, 'rounded'],
      [/^\{\{(.+)\}\}$/, 'hexagon'],
      [/^>(.+)\]$/, 'asymmetric'],
      [/^\[(.+)\]$/, 'rectangle'],
      [/^\/(.+)\/$/, 'trapezoid'],
      [/^\\+(.+)\\+$/, 'trapezoid-alt'],
    ]
    for (const [re, shape] of shapes) {
      const m = text.match(re)
      if (m) return { shape, label: m[1].trim() }
    }
    // 裸 id（无形状）
    return { shape: 'default', label: text }
  }

  // 节点定义解析：id[shape]:::cls 或 裸 id
  function parseNodeDef(s) {
    const m = s.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\s*(.*)$/)
    if (!m) return null
    const id = m[1]
    let rest = m[2].trim()
    let cls = ''
    // 先分离尾部 :::cls（支持 [形状]:::cls 与 裸id:::cls）
    const cm2 = rest.match(/^(.*?):::\s*([\w-]+)\s*$/)
    if (cm2) { rest = cm2[1].trim(); cls = cm2[2] }
    if (!rest) return { id, shape: 'default', label: id, cls }
    const { shape, label } = parseShape(rest)
    return { id, shape, label, cls }
  }

  // 确保节点存在（裸引用）
  function ensureNode(id, cls) {
    if (!nodes.has(id)) {
      const n = { id, shape: 'default', label: id, cls: cls || '' }
      nodes.set(id, n)
      declaredOrder.push(id)
      const g = curGroup()
      if (g) g.nodeIds.push(id)
    }
    return nodes.get(id)
  }

  // 解析边：from[shape] [link] to[def]（from 可带形状，如 `A([x]) --> B`）
  function parseEdge(s) {
    const m = s.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)\s*((?:[\[({][^\n]*?[\]})])?)\s*(-->|-.->|==>|--[^>]*-->|==[^>]*==>|-[^>]*\.->)\s*(.+)$/)
    if (!m) return null
    const from = m[1]
    const fromShape = m[2].trim()
    let link = m[3]
    let toPart = m[4].trim()
    let label = ''
    let style = 'solid'
    if (link === '-.->') style = 'dotted'
    else if (link === '==>') style = 'thick'
    else if (link.includes('|')) {
      label = link.slice(link.indexOf('|') + 1, link.lastIndexOf('|'))
      style = link.startsWith('-.') ? 'dotted' : link.startsWith('==') ? 'thick' : 'solid'
      // 可能还有前置标签语法 -- label --> 与 |label| 混用：取最后
    } else {
      // -- label --> 或 -. label .->
      const lm = link.match(/^--\s*(.*?)\s*-->$/)
      const dm = link.match(/^-\s*(.*?)\s*\.->$/)
      if (lm) { label = lm[1]; style = 'solid' }
      if (dm) { label = dm[1]; style = 'dotted' }
    }
    // toPart 可能以 |label| 开头（如 `-->|驳回| P1`、`-.->|重新输入| Input`）
    const lm2 = toPart.match(/^\|([^|]*)\|\s*(.*)$/)
    if (lm2) { label = lm2[1]; toPart = lm2[2].trim() }
    // to 可能是节点定义
    const toDef = parseNodeDef(toPart)
    if (!toDef) return null
    const fromNode = ensureNode(from)
    ensureNode(toDef.id, toDef.cls)
    // from 带形状（如 `A([开始：登录]) --> B`）→ 应用形状
    if (fromShape) {
      const { shape, label } = parseShape(fromShape)
      if (shape !== 'default') fromNode.shape = shape
      if (label !== from) fromNode.label = label
    }
    if (toDef.shape !== 'default' || toDef.label !== toDef.id) {
      const t = nodes.get(toDef.id)
      if (toDef.shape !== 'default') { t.shape = toDef.shape }
      if (toDef.label !== toDef.id && t.label === t.id) { t.label = toDef.label }
      if (toDef.cls) t.cls = toDef.cls
    }
    // 若 from 处也有形状定义（裸引用前已定义则跳过）
    return { from, to: toDef.id, label: label.replace(/['"]/g, ''), style }
  }

  // 主循环
  for (; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line) continue
    const lower = line.toLowerCase()

    // 头
    if (lower.startsWith('flowchart') || lower.startsWith('graph')) {
      const m = line.match(/\b(TD|TB|LR|BT|RL)\b/i)
      if (m) direction = m[1].toUpperCase()
      continue
    }
    // classDef
    if (lower.startsWith('classdef ')) {
      const m = line.match(/^classDef\s+([\w-]+)\s+(.+)$/i)
      if (m) {
        const props = {}
        m[2].split(',').forEach(p => {
          const kv = p.trim().match(/^([\w-]+)\s*:\s*(.+)$/)
          if (kv) props[kv[1].toLowerCase()] = kv[2].trim()
        })
        classDefs.set(m[1], props)
      }
      continue
    }
    // class 应用
    if (lower.startsWith('class ')) {
      const m = line.match(/^class\s+([\w\s]+?)\s+([\w-]+)$/i)
      if (m) {
        m[1].trim().split(/\s+/).forEach(id => { if (nodes.has(id)) nodes.get(id).cls = m[2] })
      }
      continue
    }
    // subgraph 开始
    if (lower.startsWith('subgraph')) {
      let rest = line.slice(9).trim()
      let gid = ''
      let label = ''
      const m = rest.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)(?:\s*\[(.*)\])?$/)
      if (m) {
        gid = m[1]
        label = m[2] ? m[2].replace(/^['"]|['"]$/g, '') : gid
      }
      const g = { id: gid, label, nodeIds: [], direction: null, depth: stack.length, parent: stack.length ? stack[stack.length - 1].id : null, children: [] }
      // 挂到父 group 的 children（多层泳道层级树——布局/渲染按树递归）
      if (stack.length) stack[stack.length - 1].children.push(g.id)
      stack.push(g)
      groups.push(g)
      continue
    }
    // subgraph 结束：独立 `end` 行（精确匹配，避免误吞节点 id 如 END([...])）
    if (lower === 'end') {
      if (stack.length) stack.pop()
      continue
    }
    // subgraph 内 direction 覆盖
    if (lower.startsWith('direction ') && stack.length) {
      const m = line.match(/\b(TD|TB|LR|BT|RL)\b/i)
      if (m) stack[stack.length - 1].direction = m[1].toUpperCase()
      continue
    }

    // 边（优先：行含箭头，支持 from 带形状如 `A([x]) --> B`）
    if (/(-->|-.->|==>)/.test(line)) {
      const e = parseEdge(line)
      if (e) { edges.push(e); continue }
    }

    // 节点单独定义（无箭头）
    if (/^[A-Za-z0-9_\u4e00-\u9fa5]+\s*[[({]/.test(line) || /^[A-Za-z0-9_\u4e00-\u9fa5]+:::/.test(line)) {
      const nd = parseNodeDef(line)
      if (nd) {
        if (!nodes.has(nd.id)) {
          nodes.set(nd.id, nd)
          declaredOrder.push(nd.id)
          const g = curGroup()
          if (g) g.nodeIds.push(nd.id)
        } else {
          const n = nodes.get(nd.id)
          if (nd.shape !== 'default') n.shape = nd.shape
          if (nd.label !== nd.id) n.label = nd.label
          if (nd.cls) n.cls = nd.cls
        }
      }
      continue
    }

    // 边（无箭头前缀匹配失败时兜底）
    const e = parseEdge(line)
    if (e) { edges.push(e); continue }

    // 兜底：节点裸定义
    const bare = line.match(/^([A-Za-z0-9_\u4e00-\u9fa5]+)$/)
    if (bare) { ensureNode(bare[1]); continue }
  }

  return {
    direction,
    nodes: [...nodes.values()],
    edges,
    groups,
    classDefs: Object.fromEntries(classDefs),
    declaredOrder,
  }
}
