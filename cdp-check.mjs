// cdp-check.mjs — 用 CDP 检查编辑器页面真实运行状态（console + DOM + 错误）
// 前置: Edge headless 已开 --remote-debugging-port=9222
const CDP_HTTP = 'http://localhost:9222'
const TARGET_URL = process.argv[2] || 'http://localhost:8080/file/editor-selfcheck.html'

async function main() {
  // 1. 新建标签页
  const r = await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent(TARGET_URL), { method: 'PUT' })
  const tab = await r.json()
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const consoleLogs = []
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id
    pending.set(mid, { res, rej })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push(m.params.args.map(a => a.value || a.description || '').join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleLogs.push('❌EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    }
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  await send('Runtime.enable')
  // 2. 等待脚本执行（轮询 #out）
  let out = ''
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500))
    const res = await send('Runtime.evaluate', { expression: "document.getElementById('out') ? document.getElementById('out').textContent : '(no #out)'", returnByValue: true })
    out = res.result.value || ''
    if (out.includes('⑨') || out.includes('异常')) break
  }
  // 3. 收集控制台
  const errs = consoleLogs.filter(l => /error|exception|failed/i.test(l))
  console.log('===== 页面自检输出 =====')
  console.log(out)
  console.log('===== 控制台异常 =====')
  console.log(errs.length ? errs.join('\n') : '（无）')
  ws.close()
  process.exit(0)
}
main().catch(e => { console.error('CDP 失败:', e.message); process.exit(1) })
