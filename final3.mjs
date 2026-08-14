const CDP_HTTP = 'http://localhost:9222'
const TARGET = 'http://localhost:8080/editor?file=gen-20260814032038.req.json'
const r = await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent(TARGET), { method: 'PUT' })
const tab = await r.json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let id = 0; const pending = new Map(); const logs = []
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return } if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text) }
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
await send('Runtime.enable')
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
const click = async (x, y, cc = 1) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc }) }
for (let i = 0; i < 30; i++) { await new Promise(r2 => setTimeout(r2, 500)); const d = await evalJs("document.getElementById('diag') ? document.getElementById('diag').textContent : 'ready'"); if (d.includes('就绪') || d === 'ready') break }
// 节点双击改字 + 线双击标签（Enter 各一次）+ Escape 各一次
const n1 = await evalJs(`(() => { const g = document.querySelector('g[data-id]'); const r = g.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } })()`)
await click(n1.x, n1.y, 1); await new Promise(r2 => setTimeout(r2, 120)); await click(n1.x, n1.y, 2); await new Promise(r2 => setTimeout(r2, 400))
await evalJs(`(() => { const i = document.querySelector('body > input'); if (i) { i.value = '改名'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) } return 1 })()`)
await new Promise(r2 => setTimeout(r2, 300))
const ep = await evalJs(`(() => { const p = document.querySelector('path[data-edge]'); const pt = p.getPointAtLength(p.getTotalLength()*0.3); const sp = pt.matrixTransform(p.getScreenCTM()); return { x: sp.x, y: sp.y } })()`)
await click(ep.x, ep.y, 1); await new Promise(r2 => setTimeout(r2, 120)); await click(ep.x, ep.y, 2); await new Promise(r2 => setTimeout(r2, 400))
await evalJs(`(() => { const i = document.querySelector('body > input'); if (i) { i.value = '通过'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) } return 1 })()`)
await new Promise(r2 => setTimeout(r2, 300))
console.log('异常:', logs.length ? logs.join(' | ') : '（无）')
ws.close(); process.exit(0)
