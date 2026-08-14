// ============================================================
// preview-server.mjs — 流程图在线预览服务（V4）
// 用法: node preview-server.mjs [port=8080] [dir=当前目录]
// 路由:
//   GET /            预览页（文件列表 + SVG 预览 + 验收报告 + PNG 导出）
//   GET /api/files   文件清单 JSON
//   GET /file/<name> 静态文件（.svg/.md/.html/.json/.mmd）
//   GET /api/png?file=xxx.svg  SVG→PNG（resvg，去 Google Fonts @import + 系统字体）
// ============================================================
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const PORT = parseInt(process.argv[2] || '8080', 10)
const DIR = path.resolve(process.argv[3] || '.')

let Resvg = null
try {
  const resvgMod = require('C:/Users/1/.workbuddy/plugins/marketplaces/experts/plugins/mermaid-diagram-expert/skills/mermaid-render/scripts/node_modules/@resvg/resvg-js')
  Resvg = resvgMod.Resvg || resvgMod
} catch (e) { console.warn('⚠️ resvg 未加载，PNG 导出不可用:', e.message.slice(0, 80)) }

const MIME = { '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json', '.mmd': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }

function listFiles() {
  const svg = [], reports = [], others = []
  for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.svg')) svg.push(f)
    else if (f.endsWith('.report.md') || f.endsWith('.report.json')) reports.push(f)
    else if (f.endsWith('.mmd') || f.endsWith('.html') || f.endsWith('.json')) others.push(f)
  }
  return { svg: svg.sort(), reports: reports.sort(), others: others.sort() }
}

function pngFromSvg(svgText) {
  if (!Resvg) return null
  const clean = svgText.replace(/@import[^;]+;/g, '').replace(/font-family:[^;"]+/g, 'font-family: sans-serif')
  const r = new Resvg(clean, { fitTo: { mode: 'width', value: 1400 }, font: { loadSystemFonts: true } })
  return r.render().asPng()
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>流程图在线预览</title>
<style>
  :root{--bg:#f6f8fa;--fg:#1f2328;--border:#d0d7de;--accent:#0969da;--muted:#57606a}
  *{box-sizing:border-box}body{margin:0;font-family:'Microsoft YaHei',system-ui,sans-serif;background:var(--bg);color:var(--fg)}
  header{background:#fff;border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:9}
  header h1{font-size:17px;margin:0;font-weight:700}
  header .tag{font-size:11px;color:var(--muted)}
  .layout{display:flex;height:calc(100vh - 61px)}
  aside{width:290px;min-width:290px;background:#fff;border-right:1px solid var(--border);overflow-y:auto;padding:10px}
  aside .sec{font-size:11px;color:var(--muted);margin:10px 6px 6px;font-weight:600}
  .item{display:block;width:100%;text-align:left;padding:7px 10px;border:none;background:none;cursor:pointer;border-radius:6px;font-size:13px;color:var(--fg)}
  .item:hover{background:#f3f4f6}.item.active{background:var(--accent);color:#fff}
  main{flex:1;overflow:auto;padding:20px 26px;background:#fff}
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
  .toolbar button{padding:7px 14px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:13px}
  .toolbar button:hover{border-color:var(--accent);color:var(--accent)}
  .toolbar .name{font-size:15px;font-weight:700}
  .stage{display:flex;gap:20px;flex-wrap:wrap}
  .canvas{border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:78vh;background:
    linear-gradient(45deg,#f0f0f0 25%,transparent 25%,transparent 75%,#f0f0f0 75%) 0 0/16px 16px,
    linear-gradient(45deg,#f0f0f0 25%,#fff 25%,#fff 75%,#f0f0f0 75%) 8px 8px/16px 16px}
  .canvas svg{display:block}
  .report{flex:1;min-width:320px;max-width:520px;border:1px solid var(--border);border-radius:8px;padding:14px 18px;font-size:13px;max-height:78vh;overflow:auto}
  .report h2{font-size:14px;margin:0 0 10px}
  .report table{border-collapse:collapse;width:100%;font-size:12.5px}
  .report th,.report td{border:1px solid var(--border);padding:5px 8px;text-align:left}
  .ok{color:#1a7f37;font-weight:700}.no{color:#cf222e;font-weight:700}
  .empty{padding:40px;text-align:center;color:var(--muted)}
  .hint{font-size:11px;color:var(--muted);margin-left:auto}
</style></head>
<body>
<header><h1>📊 流程图在线预览</h1><span class="tag">自研渲染管线 V4 · agent-batch 产物</span><span class="hint" id="dir"></span></header>
<div class="layout">
  <aside><div class="sec">SVG 图（点击预览）</div><div id="list"></div></aside>
  <main>
    <div class="toolbar"><span class="name" id="fname">—</span>
      <button onclick="dlPng()">⬇ 下载 PNG</button>
      <button onclick="dlSvg()">⬇ 下载 SVG</button>
    </div>
    <div class="stage"><div class="canvas" id="canvas"></div><div class="report" id="report"></div></div>
  </main>
</div>
<script>
let files = [], cur = '';
async function load(){
  const r = await fetch('/api/files'); files = await r.json();
  document.getElementById('dir').textContent = '目录: ' + files.dir;
  const list = document.getElementById('list');
  list.innerHTML = files.svg.map(f => '<button class="item" onclick="show(\\''+f+'\\')">'+f+'</button>').join('') || '<div class="empty">暂无 SVG</div>';
  if (files.svg.length) show(files.svg[0]);
}
async function show(f){
  cur = f;
  document.querySelectorAll('.item').forEach(b => b.classList.toggle('active', b.textContent===f));
  document.getElementById('fname').textContent = f;
  const svg = await (await fetch('/file/'+encodeURIComponent(f))).text();
  document.getElementById('canvas').innerHTML = svg;
  // 找对应报告
  const base = f.replace(/\\.svg$/,'');
  const rep = files.reports.find(r => r.startsWith(base));
  const box = document.getElementById('report');
  if (rep) {
    const md = await (await fetch('/file/'+encodeURIComponent(rep))).text();
    box.innerHTML = '<h2>验收报告 · '+rep+'</h2><pre style="white-space:pre-wrap;font-size:12px">'+md.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</pre>';
  } else box.innerHTML = '<h2>验收报告</h2><div class="empty">未找到 '+base+'.report.md</div>';
}
async function dlPng(){
  if(!cur) return;
  const r = await fetch('/api/png?file='+encodeURIComponent(cur));
  if (!r.ok) return alert('PNG 转换失败（resvg 未加载或出错）');
  const b = await r.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = cur.replace(/\\.svg$/,'.png'); a.click();
}
function dlSvg(){
  if(!cur) return;
  const a = document.createElement('a'); a.href = '/file/'+encodeURIComponent(cur); a.download = cur; a.click();
}
load();
</script></body></html>`

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  const p = u.pathname
  const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' }); res.end(body) }

  if (p === '/') return send(200, PAGE, 'text/html; charset=utf-8')
  if (p === '/api/files') {
    const f = listFiles()
    f.dir = DIR
    return send(200, JSON.stringify(f), 'application/json')
  }
  if (p === '/api/png') {
    const name = u.searchParams.get('file')
    if (!name) return send(400, '缺 file 参数')
    const fp = path.join(DIR, name)
    if (!fs.existsSync(fp)) return send(404, 'not found')
    try {
      const png = pngFromSvg(fs.readFileSync(fp, 'utf-8'))
      if (!png) return send(500, 'resvg 未加载')
      res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png)
    } catch (e) { send(500, 'PNG 转换失败: ' + e.message.slice(0, 120)) }
    return
  }
  if (p.startsWith('/file/')) {
    const name = decodeURIComponent(p.slice(6))
    const fp = path.join(DIR, name)
    if (!fp.startsWith(DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(404, 'not found')
    const ext = path.extname(fp).toLowerCase()
    return send(200, fs.readFileSync(fp), MIME[ext] || 'application/octet-stream')
  }
  send(404, 'not found')
})

server.listen(PORT, () => {
  console.log(`✅ 在线预览服务已启动: http://localhost:${PORT}`)
  console.log(`   目录: ${DIR}`)
  console.log(`   PNG 导出: ${Resvg ? '可用' : '不可用（resvg 未加载）'}`)
})
