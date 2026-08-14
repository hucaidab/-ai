// ============================================================
// split-graph.mjs — 自动拆图（V4 M2）
// 节点数 > 阈值时：
//   1. 找最长关键路径（start→end，忽略逆向边）
//   2. 非关键路径节点按"最近关键路径入口"分组 → 每簇一个子图
//   3. 主图：关键路径 + 每簇折叠为 [[子流程]] 双矩形节点
//   4. 输出：main.* + sub-N.* + index.html（图索引）
// 用法: node split-graph.mjs <in.req.json> <outBase> [--max 30]
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { parseFlow } from './parse-flow.mjs'
import { layout, layoutAuto, rerouteEdges } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'
import { validateSVG } from './validate.mjs'
import { reqToMermaid } from './req-util.mjs'

// ---------- 关键路径（DAG 最长路径，忽略逆向边） ----------
function findCriticalPath(req) {
  const nodes = req.nodes
  const idSet = new Set(nodes.map(n => n.id))
  const fwd = req.edges.filter(e => !e.reverse && idSet.has(e.from) && idSet.has(e.to))
  const start = nodes.find(n => n.shape === 'start')?.id
  const end = nodes.find(n => n.shape === 'end')?.id
  if (!start || !end) return [nodes.map(n => n.id)] // 兜底：全部当关键路径
  // Kahn 全图拓扑排序（保证前驱先处理后裔）
  const adj = new Map(); nodes.forEach(n => adj.set(n.id, []))
  const indeg = new Map(); nodes.forEach(n => indeg.set(n.id, 0))
  fwd.forEach(e => { adj.get(e.from).push(e.to); indeg.set(e.to, (indeg.get(e.to) || 0) + 1) })
  const q = nodes.filter(n => (indeg.get(n.id) || 0) === 0).map(n => n.id)
  const order = []
  while (q.length) {
    const id = q.shift(); order.push(id)
    for (const t of adj.get(id)) { indeg.set(t, indeg.get(t) - 1); if (indeg.get(t) === 0) q.push(t) }
  }
  // 环内剩余节点补到末尾
  const inOrder = new Set(order)
  nodes.forEach(n => { if (!inOrder.has(n.id)) order.push(n.id) })
  // dp 最长路径（记录前驱）
  const dist = new Map(); const prev = new Map()
  nodes.forEach(n => dist.set(n.id, -Infinity))
  dist.set(start, 0)
  for (const id of order) {
    if (!adj.has(id)) continue
    for (const t of adj.get(id)) {
      if (dist.get(t) < dist.get(id) + 1) { dist.set(t, dist.get(id) + 1); prev.set(t, id) }
    }
  }
  const pathIds = []
  let cur = end
  while (cur !== undefined && cur !== null) { pathIds.unshift(cur); cur = prev.get(cur) }
  return pathIds
}

// ---------- 分组：非关键节点按最近关键路径入口 ----------
function groupBranches(req, critical) {
  const criticalSet = new Set(critical)
  const idSet = new Set(req.nodes.map(n => n.id))
  const fwd = req.edges.filter(e => !e.reverse && idSet.has(e.from) && idSet.has(e.to))
  const entryOf = new Map() // node -> 入口关键节点
  // BFS 从每个关键节点出发，收集其支配的分支节点
  for (const c of critical) {
    const seen = new Set()
    const q = [c]
    while (q.length) {
      const v = q.shift()
      for (const e of fwd) {
        if (e.from !== v) continue
        if (criticalSet.has(e.to) || entryOf.has(e.to)) continue
        if (seen.has(e.to)) continue
        seen.add(e.to)
        entryOf.set(e.to, c)
        q.push(e.to)
      }
    }
  }
  // 簇：按入口聚合
  const clusters = new Map() // entry -> [ids]
  for (const [id, entry] of entryOf) {
    if (!clusters.has(entry)) clusters.set(entry, [])
    clusters.get(entry).push(id)
  }
  return [...clusters.entries()].map(([entry, ids]) => ({ entry, ids }))
}

// ---------- 生成子图 req ----------
function buildSubReq(req, entry, ids) {
  const idSet = new Set(ids)
  const nodes = req.nodes.filter(n => n.id === entry || idSet.has(n.id))
  const edges = req.edges.filter(e => idSet.has(e.from) && (idSet.has(e.to) || e.to === entry) || (e.from === entry && idSet.has(e.to)))
  const sub = { ...req, title: (req.title || '流程') + ' · ' + (req.nodes.find(n => n.id === entry)?.action || entry) + '子流程', lanes: req.lanes, nodes, edges }
  // 确保子图有起止：入口节点改为 start 语义（保留原形状，另加标注）
  const entryNode = sub.nodes.find(n => n.id === entry)
  if (entryNode && entryNode.shape !== 'start') {
    // 复制一个"进入"开始节点
    sub.nodes.unshift({ ...entryNode, id: entry + '_IN', shape: 'start', action: '进入：' + entryNode.action })
    edges.forEach(e => { if (e.from === entry) e.from = entry + '_IN' })
  }
  return sub
}

// ---------- 单图渲染 + 验收（P0-3：失败自动修复循环 ≤3 轮） ----------
export function renderOne(req, outBase, autoOnly = false, maxFixRounds = 3, theme = 'github-light') {
  let curReq = req
  let fixLog = []
  for (let round = 0; round <= maxFixRounds; round++) {
    const src = reqToMermaid(curReq)
    const graph = parseFlow(src)
    // 拆分后的主图/子图强制 auto 线性布局（不保留泳道分组）
    const lay = autoOnly
      ? layoutAuto(graph.nodes, graph.edges)
      : layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, 'auto')
    // 手动布局优先：req 中节点带 pos → 覆盖自动布局位置（编辑器保存/渲染一致性）
    // 有 pos 或任一边带 wp（航点）时重算边路由（否则 wp 不生效/边连旧位置）
    const hasPos = (curReq.nodes || []).some(n => n.pos)
    const hasWp = (curReq.edges || []).some(e => e.wp && e.wp.length)
    if (hasPos || hasWp) {
      if (curReq.nodes) {
        lay.nodes.forEach(n => {
          const rn = curReq.nodes.find(x => x.id === n.id)
          if (rn && rn.pos) n.pos = rn.pos
        })
      }
      rerouteEdges(lay, curReq.edges)
    }
    const svg = renderSVG(lay, { classDefs: graph.classDefs, title: curReq.title || '', theme })
    const expectText = autoOnly
      ? curReq.nodes.filter(n => n.shape === 'start' || n.shape === 'end').map(n => n.action)
      : (curReq.lanes || []).map(l => l.dept).concat(curReq.nodes.filter(n => n.shape === 'start' || n.shape === 'end').map(n => n.action))
    const entityNodeCount = graph.nodes.filter(n => n.shape !== 'subroutine').length
    const report = validateSVG(svg, {
      nodeCount: graph.nodes.length,
      entityNodeCount,
      edgeCount: graph.edges.length,
      diamondCount: graph.nodes.filter(n => n.shape === 'diamond').length,
      diamondLabeledCount: graph.edges.filter(e => graph.nodes.find(n => n.id === e.from && n.shape === 'diamond') && e.label).length,
      reverseCount: curReq.edges.filter(e => e.reverse).length,
      expectText, expectColors: [], mode: lay.mode,
    })
    if (report.pass || round === maxFixRounds) {
      fs.writeFileSync(outBase + '.svg', svg, 'utf-8')
      fs.writeFileSync(outBase + '.req.json', JSON.stringify(curReq, null, 2), 'utf-8')
      let fixNote = fixLog.length ? '\n- 自动修复：' + fixLog.join('；') : ''
      fs.writeFileSync(outBase + '.report.md', `# ${curReq.title}\n\n- 模式：${lay.mode}，节点 ${graph.nodes.length}，边 ${graph.edges.length}\n- 结论：${report.pass ? '✅ 通过' : '❌ ' + report.summary}${fixNote}\n`, 'utf-8')
      const fixed = fixLog.length > 0
      if (fixed) console.log(`🔧 自动修复 ${fixLog.length} 处后通过：${fixLog.join('、')}`)
      return { title: curReq.title, pass: report.pass, summary: report.summary, nodes: graph.nodes.length, file: path.basename(outBase) + '.svg', fixed, fixLog }
    }
    // 失败 → 按失败项针对性修复
    if (round < maxFixRounds) {
      const failedNames = report.checks.filter(c => !c.pass).map(c => c.name)
      const { req: nextReq, fixes } = applyReportFix(curReq, failedNames)
      if (!fixes.length) break // 无法继续修复
      fixLog.push(...fixes)
      curReq = nextReq
    }
  }
  // 最终兜底：最后一次渲染结果（未通过也落盘）
  const src = reqToMermaid(curReq)
  const graph = parseFlow(src)
  const lay = layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, 'auto')
  const svg = renderSVG(lay, { classDefs: graph.classDefs, title: curReq.title || '', theme })
  const report = validateSVG(svg, { nodeCount: graph.nodes.length, edgeCount: graph.edges.length })
  fs.writeFileSync(outBase + '.svg', svg, 'utf-8')
  fs.writeFileSync(outBase + '.req.json', JSON.stringify(curReq, null, 2), 'utf-8')
  fs.writeFileSync(outBase + '.report.md', `# ${curReq.title}\n\n- 节点 ${graph.nodes.length}，边 ${graph.edges.length}\n- 结论：❌ ${report.summary}\n`, 'utf-8')
  return { title: curReq.title, pass: false, summary: report.summary, nodes: graph.nodes.length, file: path.basename(outBase) + '.svg', fixed: fixLog.length > 0, fixLog }
}

// 按验收失败项应用修复（P0-3）
import { autoFix } from './llm-model.mjs'
function applyReportFix(req, failedNames) {
  const fixes = []
  const next = JSON.parse(JSON.stringify(req))
  const modelFix = failedNames.some(n => n.includes('起止') || n.includes('开始/结束') || n.includes('判断'))
  if (modelFix) {
    const fx = autoFix(next)
    fixes.push(...fx.fixed)
  }
  // 泳道不重叠失败 → 记录降级提示（由外层 autoOnly 处理）
  if (failedNames.some(n => n.includes('泳道'))) fixes.push('泳道布局异常，建议切换线性布局')
  return { req: fixes.length ? next : req, fixes: [...new Set(fixes)] }
}

// ---------- 拆分主流程（可复用：agent-flow 调用） ----------
export function splitAndRender(req, outBase, MAX = 30, theme = 'github-light') {
  const total = req.nodes.length
  console.log(`输入: ${req.title || outBase}（${total} 节点，阈值 ${MAX}）`)

  if (total <= MAX) {
    const r = renderOne(req, outBase, false, 3, theme)
    console.log(`${r.pass ? '✅' : '❌'} 未超阈值，直接渲染 — ${r.summary}`)
    return { main: r, subs: [], indexFile: null, pass: r.pass }
  }

  const critical = findCriticalPath(req)
  const clusters = groupBranches(req, critical)
  const criticalSet = new Set(critical)
  const SEG = Math.max(12, MAX - 4)
  console.log(`关键路径 ${critical.length} 节点，分支簇 ${clusters.length} 个，分段大小 ${SEG}`)

  const subResults = []

  // ---- 分支簇折叠辅助 ----
  const clusterInfo = clusters.map((c, i) => {
    const name = '子流程' + (i + 1) + '·' + (req.nodes.find(n => n.id === c.entry)?.action || c.entry)
    return { ...c, name, foldId: 'SUB' + (i + 1), node: { id: 'SUB' + (i + 1), dept: req.nodes.find(n => n.id === c.entry)?.dept || req.lanes?.[0]?.dept, role: '', action: name, shape: 'subroutine' } }
  })
  const foldedIds = new Set(clusters.flatMap(c => c.ids))
  const foldOf = id => clusterInfo.find(c => c.ids.includes(id))

  // ---- 构造"主图 + 子图"的边分配：节点集合归属 ----
  // ownerOf(id) = 'main' | 'subN' | 'fold-SUBn'（折叠节点在主图）
  function buildMainAndSubs(mainIds, subs) {
    // subs: [{id:'sub1', ids:[...]}, ...]
    const owner = new Map()
    mainIds.forEach(id => owner.set(id, 'main'))
    subs.forEach((s, i) => s.ids.forEach(id => owner.set(id, 'sub' + (i + 1))))
    subs.forEach(s => owner.set(s.foldId, 'main'))   // 折叠节点归主图
    // 主图节点（含折叠子流程引用节点）
    const mainNodes = req.nodes.filter(n => owner.get(n.id) === 'main')
    subs.forEach(s => mainNodes.push({ id: s.foldId, dept: req.lanes?.[0]?.dept, role: '', action: s.name, shape: 'subroutine' }))
    // 子图节点集合
    const mainEdges = []
    const subEdges = subs.map(() => [])
    const subEntry = {}   // 子图入口节点 id
    const subEnd = {}     // 子图结束节点 id
    req.edges.forEach(e => {
      const oa = owner.get(e.from), ob = owner.get(e.to)
      if (!oa || !ob) return
      if (oa === 'main' && ob === 'main') { mainEdges.push({ ...e }); return }
      if (oa === ob && oa.startsWith('sub')) {
        const idx = parseInt(oa.slice(3), 10) - 1
        subEdges[idx].push({ ...e }); return
      }
      // 主图 ↔ 子图边界边：主图保留（到折叠节点或从折叠节点）
      const toSub = ob.startsWith('sub'), fromSub = oa.startsWith('sub')
      const idx = toSub ? parseInt(ob.slice(3), 10) - 1 : fromSub ? parseInt(oa.slice(3), 10) - 1 : -1
      const sub = subs[idx]
      if (!sub) return
      const foldId = sub.foldId
      if (!fromSub && toSub) {
        mainEdges.push({ ...e, to: foldId })
        if (!subEntry[idx]) subEntry[idx] = e.from
      } else if (fromSub && !toSub) {
        mainEdges.push({ ...e, from: foldId })
        if (!subEnd[idx]) subEnd[idx] = e.to
      } else if (fromSub && toSub && oa !== ob) {
        const f2 = subs[parseInt(oa.slice(3), 10) - 1].foldId
        const t2 = subs[parseInt(ob.slice(3), 10) - 1].foldId
        mainEdges.push({ ...e, from: f2, to: t2 })
      }
    })
    // 子图补齐起止
    const subReqs = subs.map((s, i) => {
      const ids = new Set(s.ids)
      let nodes = req.nodes.filter(n => ids.has(n.id))
      let edges = subEdges[i]
      const inId = subEntry[i], outId = subEnd[i]
      if (inId && !nodes.find(n => n.id === inId)) { nodes.unshift(req.nodes.find(n => n.id === inId)); ids.add(inId) }
      if (outId && !nodes.find(n => n.id === outId)) { nodes.push(req.nodes.find(n => n.id === outId)); ids.add(outId) }
      // 入口改 start、出口改 end
      nodes = nodes.map(n => (n.id === inId ? { ...n, shape: 'start', action: '进入：' + n.action } : n.id === outId ? { ...n, shape: 'end', action: n.action + '（结束）' } : n))
      return { ...req, title: req.title + ' · ' + s.name, lanes: req.lanes, nodes, edges }
    })
    // 主图补齐起止
    const hasStart = mainNodes.some(n => n.shape === 'start')
    const hasEnd = mainNodes.some(n => n.shape === 'end')
    if (!hasStart) mainNodes.unshift({ id: '__START__', dept: req.lanes?.[0]?.dept, role: '', action: '开始', shape: 'start' })
    if (!hasEnd) {
      mainNodes.push({ id: '__END__', dept: req.lanes?.[0]?.dept, role: '', action: '结束：流程完成', shape: 'end' })
      const outIds = new Set(mainEdges.map(e => e.from))
      mainNodes.filter(n => n.id !== '__END__' && !outIds.has(n.id)).forEach(n => mainEdges.push({ from: n.id, to: '__END__', label: '', reverse: false }))
    }
    return { mainReq: { ...req, title: req.title + '（主流程）', lanes: req.lanes, nodes: mainNodes, edges: mainEdges }, subReqs }
  }

  if (critical.length <= SEG) {
    // 主图 = 关键路径 + 分支簇折叠
    const mainIds = critical
    const subs = clusters.map(c => ({ ids: c.ids, foldId: c.node.id, name: c.name }))
    const { mainReq, subReqs } = buildMainAndSubs(mainIds, subs)
    const mr = renderOne(mainReq, outBase + "-main", true)
    subReqs.forEach((sr, i) => {
      const r = renderOne(sr, `${outBase}-sub${i + 1}`, true)
      subResults.push({ ...r, name: subs[i].name })
      console.log(`  ${r.pass ? '✅' : '❌'} 子图${i + 1} ${subs[i].name} — ${r.summary}`)
    })
    console.log(`✅ 主图: ${mr.pass ? '通过' : mr.summary}`)
    const indexFile = buildIndex(req, outBase, mr, subResults, total, MAX)
    return { main: mr, subs: subResults, indexFile, pass: mr.pass && subResults.every(s => s.pass) }
  }

  // ---- 链式分段：关键路径超长时切段 ----
  const segs = []
  for (let i = 0; i < critical.length; i += SEG) segs.push(critical.slice(i, i + SEG))
  const segIdxOf = {}
  segs.forEach((seg, si) => seg.forEach(id => { segIdxOf[id] = si }))
  console.log(`关键路径过长，切为 ${segs.length} 段`)

  // 分支簇归入入口所在段
  const subDefs = segs.slice(1).map((seg, i) => ({ ids: [...seg], foldId: 'SUB' + (i + 2), name: '分段' + (i + 2) }))
  clusters.forEach(c => {
    const si = segIdxOf[c.entry]
    if (si >= 1) subDefs[si - 1].ids.push(...c.ids)
    else subDefs.push({ ids: c.ids, foldId: 'SUB' + (subDefs.length + 1), name: c.name })
  })
  const { mainReq, subReqs } = buildMainAndSubs(segs[0], subDefs)
  const mr = renderOne(mainReq, outBase + "-main", true)
  subReqs.forEach((sr, i) => {
    const r = renderOne(sr, `${outBase}-sub${i + 1}`, true)
    subResults.push({ ...r, name: subDefs[i].name })
    console.log(`  ${r.pass ? '✅' : '❌'} 子图${i + 1} ${subDefs[i].name} — ${r.summary}`)
  })
  console.log(`✅ 主图: ${mr.pass ? '通过' : mr.summary}`)
  const indexFile = buildIndex(req, outBase, mr, subResults, total, MAX)
  return { main: mr, subs: subResults, indexFile, pass: mr.pass && subResults.every(s => s.pass) }
}

// CLI 入口
if (process.argv[1] && process.argv[1].endsWith('split-graph.mjs')) {
  const [,, inFile, outBase, maxFlag, maxVal] = process.argv
  if (!inFile || !outBase) { console.error('用法: node split-graph.mjs <in.req.json> <outBase> [--max 30]'); process.exit(1) }
  const MAX = maxFlag === '--max' ? parseInt(maxVal || '30', 10) : 30
  const req = JSON.parse(fs.readFileSync(inFile, 'utf-8'))
  const result = splitAndRender(req, outBase, MAX)
  process.exit(result.pass ? 0 : 2)
}

function buildIndex(req, outBase, mr, subResults, total, MAX) {
  const index = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>图索引 · ${req.title}</title>
<style>body{font-family:'Microsoft YaHei',sans-serif;margin:30px;background:#f6f8fa;color:#1f2328}
.card{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:18px 22px;margin:14px 0}
a{color:#0969da;text-decoration:none}img{max-width:100%;border:1px solid #e1e4e8;border-radius:6px;margin-top:10px}
h1{font-size:22px}.badge{padding:2px 10px;border-radius:12px;font-size:12px;color:#fff}
.b-ok{background:#1a7f37}.b-no{background:#cf222e}</style></head><body>
<h1>📊 ${req.title} · 拆图索引</h1>
<p>主流程 + ${subResults.length} 张子流程（原 ${total} 节点，阈值 ${MAX}）</p>
<div class="card"><h2>主流程 <span class="badge ${mr.pass ? 'b-ok' : 'b-no'}">${mr.pass ? '通过' : mr.summary}</span></h2>
<a href="${path.basename(outBase)}-main.svg">${path.basename(outBase)}-main.svg</a><br><img src="${path.basename(outBase)}-main.svg"></div>
${subResults.map((s, i) => `<div class="card"><h2>子流程 ${i + 1}：${s.name} <span class="badge ${s.pass ? 'b-ok' : 'b-no'}">${s.pass ? '通过' : s.summary}</span></h2>
<a href="${path.basename(outBase)}-sub${i + 1}.svg">${path.basename(outBase)}-sub${i + 1}.svg</a><br><img src="${path.basename(outBase)}-sub${i + 1}.svg"></div>`).join('')}
</body></html>`
  fs.writeFileSync(outBase + '-index.html', index, 'utf-8')
  console.log(`📊 拆图完成: ${outBase}-main.svg + ${subResults.length} 张子图 + ${outBase}-index.html`)
  return outBase + '-index.html'
}
