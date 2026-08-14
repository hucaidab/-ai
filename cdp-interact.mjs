// cdp-interact.mjs — 真实鼠标事件交互测试（CDP Input.dispatchMouseEvent）
// 复现用户"点击/拖动没反应"：真实页面 + 真实文件 + 真实鼠标事件
const CDP_HTTP = 'http://localhost:9222'
const TARGET = process.argv[2] || 'http://localhost:8080/editor?file=gen-20260814032038.req.json'

async function main() {
  const r = await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent(TARGET), { method: 'PUT' })
  const tab = await r.json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const logs = []
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value || a.description || '').join(' '))
    if (m.method === 'Runtime.exceptionThrown') logs.push('❌EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    if (m.method === 'Runtime.evaluate') {}
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable')
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

  // 1. 等待诊断条就绪（最多 15s）
  let diag = ''
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500))
    diag = await evalJs("document.getElementById('diag') ? document.getElementById('diag').textContent : '(无诊断条)'")
    if (diag.includes('就绪')) break
  }
  console.log('① 诊断条:', diag)

  // 2. 注入事件探针（capture 监听 pointerdown/mousedown，确认事件是否到达页面）
  const probeInjected = await evalJs(`(() => {
    window.__probe = { pd: 0, md: 0, ptrTargets: [], msTargets: [] }
    const cv = document.getElementById('cv')
    if (!cv) return 'NO_CV'
    document.addEventListener('pointerdown', e => { window.__probe.pd++; window.__probe.ptrTargets.push(e.target.tagName) }, true)
    document.addEventListener('mousedown', e => { window.__probe.md++; window.__probe.msTargets.push(e.target.tagName) }, true)
    return 'BOUND cv._bound=' + cv._bound
  })()`)
  console.log('①b 探针注入:', probeInjected)

  // 3. 取第一个节点的屏幕坐标（真实渲染位置）
  const rect = await evalJs(`(() => {
    const g = document.querySelector('g[data-id]')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: g.getAttribute('data-id') }
  })()`)
  console.log('② 节点位置:', JSON.stringify(rect))
  if (!rect) { console.log('❌ 页面未渲染节点（诊断条卡在加载中 = init 未完成）'); ws.close(); process.exit(1) }

  // 4. 真实点击（mousePressed + mouseReleased）
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  await click(rect.x, rect.y)
  await new Promise(r => setTimeout(r, 300))
  const sel = await evalJs('window.__editor ? JSON.stringify(window.__editor.S.selected) : "(no editor)"')
  console.log('③ 点击后选中:', sel)
  console.log('③b 探针结果:', await evalJs('JSON.stringify(window.__probe)'))

  // 4. 真实拖拽（pressed → moved×3 → released）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 100))
  for (let i = 1; i <= 3; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + i * 20, y: rect.y + i * 12, button: 'left', buttons: 1 })
    await new Promise(r => setTimeout(r, 100))
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 60, y: rect.y + 36, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 300))
  const pos = await evalJs(`(() => {
    const s = window.__editor ? window.__editor.S : null
    if (!s || !s.selected || s.selected.kind !== 'node') return '未选中'
    const n = s.req.nodes.find(x => x.id === s.selected.id)
    return n ? JSON.stringify(n.pos) : '无节点'
  })()`)
  console.log('④ 拖拽后节点位置:', pos)

  // 4b. 视觉层断言：节点 g 的 transform 必须与 pos 一致（transform 承载位置，避免绝对坐标叠加乱飘）
  const visual = await evalJs(`(() => {
    const s = window.__editor ? window.__editor.S : null
    if (!s || !s.selected || s.selected.kind !== 'node') return { err: '未选中' }
    const n = s.req.nodes.find(x => x.id === s.selected.id)
    const g = document.querySelector('g[data-id="' + n.id + '"]')
    if (!g) return { err: '无 g' }
    const tr = (g.getAttribute('transform') || '')
    const expect = 'translate(' + n.pos.x + ',' + n.pos.y + ')'
    return { tr, expect, visualOK: tr === expect, rect: JSON.stringify(g.getBoundingClientRect()) }
  })()`)
  console.log('④b 视觉层(transform):', JSON.stringify(visual))

  // 4c. 边跟随断言：选中节点的相连边 path d 必须变化（拖动中实时重路由），
  // 且路由起点落在节点**新边界框**上（8 锚点机制：pos.x / pos.x+w / pos.y / pos.y+h）
  const edgeFollow = await evalJs(`(() => {
    const s = window.__editor ? window.__editor.S : null
    if (!s || !s.selected || s.selected.kind !== 'node') return { err: '未选中' }
    const id = s.selected.id
    const related = s.req.edges.filter(e => e.from === id || e.to === id)
    const dSet = []
    for (const e of related) {
      const domIdx = s._edgeMap.indexOf(s.req.edges.indexOf(e))
      if (domIdx < 0) continue
      const p = document.querySelector('path[data-eidx="' + domIdx + '"]')
      if (p) dSet.push(p.getAttribute('d'))
    }
    const n = s.req.nodes.find(x => x.id === id)
    const sz = s._nodeSize[id] || { w: 180, h: 50 }
    // 边界候选坐标（锚点落点）
    const borderCoords = [String(n.pos.x), String(n.pos.x + sz.w), String(n.pos.y), String(n.pos.y + sz.h)]
    const onBorder = dSet.length && dSet.every(d => borderCoords.some(c => d.includes(c)))
    return { related: related.length, paths: dSet.length, onBorder, sample: (dSet[0] || '').slice(0, 80) }
  })()`)
  console.log('④c 边跟随(锚点边界):', JSON.stringify(edgeFollow))

  // 5. 控制台异常
  const errs = logs.filter(l => /error|exception|failed/i.test(l))
  console.log('⑤ 控制台异常:', errs.length ? errs.join('\n') : '（无）')
  ws.close()
  process.exit(0)
}
main().catch(e => { console.error('CDP 失败:', e.message); process.exit(1) })
