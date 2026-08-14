// cdp-wp.mjs — 航点（waypoints）交互真实浏览器测试
// 流程：选边 → 双击路径加航点 → 拖手柄移动 → 双击手柄删航点 → 验证 wp 数据
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
    if (m.method === 'Runtime.exceptionThrown') logs.push('❌EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable')
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  const click = async (x, y, cc = 1) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc })
  }

  // 1. 等待就绪
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500))
    const d = await evalJs("document.getElementById('diag') ? document.getElementById('diag').textContent : 'ready'")
    if (d.includes('就绪') || d === 'ready') break
  }

  // 2. 选中一条边（找有折角的边：折点不全共线，便于双击路径/拖折点）
  //    仅取可视区内的边（fitToView 可能滚动居中，视口外的边点不到）
  const edgeInfo = await evalJs(`(() => {
    const cw = document.getElementById('canvasWrap').getBoundingClientRect()
    const edges = [...document.querySelectorAll('path[data-edge]')]
    for (const p of edges) {
      const d = p.getAttribute('d')
      const pts = (d.match(/[-\\d.]+/g) || []).map(Number)
      const xs = pts.filter((_, i) => i % 2 === 0)
      const ys = pts.filter((_, i) => i % 2 === 1)
      const spread = Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)
      if (spread > 60) { // 有实际折角
        const pt = p.getPointAtLength(p.getTotalLength() * 0.3) // 路径 30% 处（避开中间折点）
        const sp = pt.matrixTransform(p.getScreenCTM())
        if (sp.x < cw.left + 15 || sp.x > cw.right - 15 || sp.y < cw.top + 15 || sp.y > cw.bottom - 15) continue // 视口外跳过
        return { x: sp.x, y: sp.y, eidx: p.getAttribute('data-eidx'), d: d.slice(0, 60) }
      }
    }
    return null
  })()`)
  console.log('① 边信息:', JSON.stringify(edgeInfo))
  if (!edgeInfo) { console.log('❌ 无折角边'); ws.close(); process.exit(1) }
  await click(edgeInfo.x, edgeInfo.y)
  await new Promise(r => setTimeout(r, 300))
  const sel = await evalJs('JSON.stringify(window.__editor.S.selected)')
  console.log('①b 选中:', sel)

  // 3. 手柄渲染
  const handles = await evalJs(`(() => {
    const hs = document.querySelectorAll('.wp-handle')
    return { count: hs.length, mids: [...hs].slice(0, 3).map(h => { const r = h.getBoundingClientRect(); return { x: r.x + 5, y: r.y + 5 } }) }
  })()`)
  console.log('② 手柄数:', JSON.stringify(handles))

  // 4. 拖线本体 → 接管折点为 wp（双击线语义已改为编辑标签，加航点由拖线接管承担）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: edgeInfo.x, y: edgeInfo.y, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 100))
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edgeInfo.x + 20, y: edgeInfo.y + 10, button: 'left', buttons: 1 })
  await new Promise(r => setTimeout(r, 100))
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: edgeInfo.x + 20, y: edgeInfo.y + 10, button: 'left', clickCount: 1 })
  await new Promise(r => setTimeout(r, 400))
  const wpAfterAdd = await evalJs(`(() => {
    const s = window.__editor.S
    if (!s.selected || s.selected.kind !== 'edge') return '未选中边'
    const e = s.req.edges[s.selected.idx]
    return JSON.stringify(e.wp || [])
  })()`)
  console.log('③ 拖线接管后 wp:', wpAfterAdd)

  // 5. 拖第一个中间手柄 → 移动航点
  const hPos = await evalJs(`(() => {
    const h = document.querySelectorAll('.wp-handle')[1] // 第一个中间折点
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { x: r.x + 5, y: r.y + 5 }
  })()`)
  if (hPos) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hPos.x, y: hPos.y, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 80))
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hPos.x + 40, y: hPos.y + 20, button: 'left', buttons: 1 })
    await new Promise(r => setTimeout(r, 80))
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hPos.x + 40, y: hPos.y + 20, button: 'left', clickCount: 1 })
    await new Promise(r => setTimeout(r, 300))
  }
  const wpAfterDrag = await evalJs(`(() => {
    const s = window.__editor.S
    if (!s.selected || s.selected.kind !== 'edge') return '未选中边'
    const e = s.req.edges[s.selected.idx]
    return JSON.stringify(e.wp || [])
  })()`)
  console.log('④ 拖手柄后 wp:', wpAfterDrag)

  // 6. 双击中间手柄 → 删航点
  const hPos2 = await evalJs(`(() => {
    const h = document.querySelectorAll('.wp-handle')[1]
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { x: r.x + 5, y: r.y + 5 }
  })()`)
  if (hPos2) {
    await click(hPos2.x, hPos2.y, 1)
    await new Promise(r => setTimeout(r, 100))
    await click(hPos2.x, hPos2.y, 2)
    await new Promise(r => setTimeout(r, 400))
  }
  const wpAfterDel = await evalJs(`(() => {
    const s = window.__editor.S
    if (!s.selected || s.selected.kind !== 'edge') return '未选中边'
    const e = s.req.edges[s.selected.idx]
    return JSON.stringify(e.wp || [])
  })()`)
  console.log('⑤ 双击手柄删后 wp:', wpAfterDel)

  // 7. 控制台异常
  console.log('⑥ 控制台异常:', logs.length ? logs.join('\n') : '（无）')
  ws.close()
  process.exit(0)
}
main().catch(e => { console.error('CDP 失败:', e.message); process.exit(1) })
