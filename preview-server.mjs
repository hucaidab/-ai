// ============================================================
// preview-server.mjs — 流程图工作台（在线预览 + 一句话生成）
// 用法: node preview-server.mjs [port=8080] [dir=当前目录]
// 路由:
//   GET /            预览页（文件列表 + SVG 预览 + 验收报告 + PNG 导出）
//   GET /generate    生成器（员工入口：一句话 → 出图，零命令行）
//   POST /api/generate   {text} → LLM/DSL/模板建模 → 渲染 → 验收 → 落盘
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

// ---------- 生成器依赖（懒加载，避免启动慢） ----------
let genMods = null
async function loadGen() {
  if (genMods) return genMods
  const { llmModel } = await import('./llm-model.mjs')
  const { splitAndRender } = await import('./split-graph.mjs')
  genMods = { llmModel, splitAndRender }
  return genMods
}

// 示例需求（员工一键填入）
const EXAMPLES = [
  { label: '请假审批', text: '请假审批流程：员工提交申请，直属经理审批，HR 核对额度备案，结束' },
  { label: '费用报销', text: '费用报销流程：员工提交报销单，部门经理审批，财务审核票据，出纳打款，员工确认收款' },
  { label: '采购到付款', text: '采购到付款流程：采购员提交采购申请，采购经理审批（驳回退回），供应商发货，仓库收货质检（不合格退货），财务三单匹配后付款' },
  { label: '员工入职', text: '员工入职流程：HR 发 offer，员工报到，HR 办入职手续，部门领人，IT 配电脑账号' },
  { label: '手机 MES 生产', text: '手机MES生产制造：计划员下达生产工单并排程，仓管员按工单备料（缺料补料），SMT车间领料上料、首件检验（不合格调参重试）后批量贴片回流焊，组装车间整机组装，测试部功能测试（不良返工）再老化测试，品质部成品检验（不合格返工重检），包装部包装，仓管员入库 MES 过账，生产完成。涉及生产计划、仓储部、SMT车间、组装车间、测试部、品质部、包装部七个部门' },
]

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

// ---------- 生成器页面（员工傻瓜入口） ----------
const GEN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>流程图生成器</title>
<style>
  :root{--bg:#f6f8fa;--fg:#1f2328;--border:#d0d7de;--accent:#0969da;--accent2:#1a7f37;--muted:#57606a;--warn:#9a6700}
  *{box-sizing:border-box}body{margin:0;font-family:'Microsoft YaHei',system-ui,sans-serif;background:var(--bg);color:var(--fg)}
  header{background:#fff;border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:9}
  header h1{font-size:17px;margin:0;font-weight:700}
  header a{font-size:13px;color:var(--accent);text-decoration:none;margin-left:auto}
  .wrap{max-width:980px;margin:22px auto;padding:0 18px}
  .card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:20px 22px}
  .card h2{font-size:15px;margin:0 0 6px}
  .sub{font-size:12.5px;color:var(--muted);margin:0 0 14px}
  textarea{width:100%;height:110px;border:1px solid var(--border);border-radius:8px;padding:12px 14px;font-size:14px;font-family:inherit;resize:vertical;outline:none}
  textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(9,105,218,.15)}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}
  .chip{padding:6px 14px;border:1px solid var(--border);border-radius:20px;background:#f6f8fa;cursor:pointer;font-size:12.5px;color:var(--fg)}
  .chip:hover{border-color:var(--accent);color:var(--accent)}
  .btn{padding:11px 34px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}.btn:disabled{opacity:.5;cursor:wait}
  .status{margin-top:14px;font-size:13px;min-height:20px;color:var(--muted)}
  .result{margin-top:14px;display:none}
  .result.show{display:block}
  .badge{display:inline-block;padding:4px 14px;border-radius:14px;font-size:12.5px;font-weight:700;color:#fff}
  .b-ok{background:var(--accent2)}.b-no{background:#cf222e}
  .res-head{display:flex;align-items:center;gap:12px;margin:6px 0 12px;flex-wrap:wrap}
  .res-head .t{font-size:15px;font-weight:700}
  .dl-btn{padding:6px 16px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:13px}
  .dl-btn:hover{border-color:var(--accent);color:var(--accent)}
  .canvas{border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:72vh;background:
    linear-gradient(45deg,#f0f0f0 25%,transparent 25%,transparent 75%,#f0f0f0 75%) 0 0/16px 16px,
    linear-gradient(45deg,#f0f0f0 25%,#fff 25%,#fff 75%,#f0f0f0 75%) 8px 8px/16px 16px}
  .canvas svg{display:block;width:100%;height:auto}
  .report{margin-top:14px;border:1px solid var(--border);border-radius:8px;padding:12px 16px;font-size:12.5px;max-height:340px;overflow:auto}
  .report pre{margin:0;white-space:pre-wrap;font-family:inherit}
  .err{background:#fff5f5;border:1px solid #ffcecb;color:#cf222e;border-radius:8px;padding:12px 16px;font-size:13px}
  .err b{display:block;margin-bottom:4px}
  .foot{text-align:center;color:var(--muted);font-size:12px;margin:20px 0}
</style></head>
<body>
<header><h1>✏️ 流程图生成器</h1><a href="/">查看已有图 →</a></header>
<div class="wrap">
  <div class="card">
    <h2>用一句话描述你的流程</h2>
    <p class="sub">想画什么流程？说清楚「谁做什么、判断条件、退回情况」，点生成即可（例：员工提交申请，经理审批，驳回退回）</p>
    <textarea id="in" placeholder="例：请假审批流程：员工提交申请，直属经理审批，HR 核对额度备案，结束"></textarea>
    <div class="chips" id="chips"></div>
    <button class="btn" id="go">⚡ 生成流程图</button>
    <div class="status" id="status"></div>
    <div class="result" id="res">
      <div class="res-head">
        <span class="badge" id="badge"></span>
        <span class="t" id="rt"></span>
        <button class="dl-btn" id="dlPng">⬇ 下载 PNG 图片</button>
        <button class="dl-btn" id="dlSvg">⬇ 下载 SVG</button>
      </div>
      <div class="canvas" id="canvas"></div>
      <div class="report" id="report"></div>
    </div>
  </div>
  <div class="foot">没写清楚也没关系，AI 会自动帮你补全 · 生成后可在「查看已有图」里继续浏览</div>
</div>
<script>
const EXAMPLES = ${JSON.stringify(EXAMPLES)};
document.getElementById('chips').innerHTML = EXAMPLES.map(e=>'<button class="chip" onclick="fill(\\''+e.label+'\\')">'+e.label+'</button>').join('');
function fill(k){ const e=EXAMPLES.find(x=>x.label===k); document.getElementById('in').value=e.text; }
let cur = null;
document.getElementById('go').onclick = async () => {
  const text = document.getElementById('in').value.trim();
  const st = document.getElementById('status'), res = document.getElementById('res');
  if(!text){ st.textContent='⚠️ 先在上面的框里写一句话哦～'; return; }
  const btn = document.getElementById('go'); btn.disabled = true;
  st.textContent = '⏳ 正在理解你的需求并画图…（一般 5~20 秒）';
  res.classList.remove('show');
  try {
    const r = await fetch('/api/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text}) });
    const d = await r.json();
    if(!d.ok){ st.innerHTML=''; res.innerHTML='<div class="err"><b>😅 没生成成功</b>'+d.error+'</div>'; return; }
    cur = d.file;
    st.textContent = '✅ 完成（来源：' + d.source + '）';
    res.classList.add('show');
    document.getElementById('badge').textContent = d.pass ? '✓ 验收通过' : '⚠ 有 1 项未达标';
    document.getElementById('badge').className = 'badge ' + (d.pass ? 'b-ok' : 'b-no');
    document.getElementById('rt').textContent = d.title + '（' + d.nodes + ' 节点 · ' + d.lanes + ' 个部门泳道）';
    document.getElementById('canvas').innerHTML = d.svg;
    document.getElementById('report').innerHTML = '<b>验收报告</b><pre>' + d.reportMd.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>';
  } catch(e){ st.innerHTML=''; res.innerHTML='<div class="err"><b>😅 服务出错</b>'+e.message+'</div>'; }
  finally { btn.disabled = false; }
};
document.getElementById('dlPng').onclick = async () => {
  if(!cur) return;
  const r = await fetch('/api/png?file='+encodeURIComponent(cur));
  if(!r.ok) return alert('图片转换失败');
  const b = await r.blob(), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = cur.replace(/\\.svg$/,'.png'); a.click();
};
document.getElementById('dlSvg').onclick = () => {
  if(!cur) return;
  const a = document.createElement('a'); a.href = '/file/'+encodeURIComponent(cur); a.download = cur; a.click();
};
</script></body></html>`

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
  if (p === '/generate') return send(200, GEN_PAGE, 'text/html; charset=utf-8')
  if (p === '/api/generate' && req.method === 'POST') {
    let body = ''
    for await (const c of req) body += c
    let text = ''
    try { text = (JSON.parse(body || '{}').text || '').trim() } catch { return send(400, '参数格式错误') }
    if (!text) return send(400, JSON.stringify({ ok: false, error: '需求不能为空，先写一句话再点生成～' }))
    try {
      const { llmModel, splitAndRender } = await loadGen()
      const r = await llmModel(text)
      if (!r.req) return send(200, JSON.stringify({ ok: false, error: '没看懂你的需求，请说得更具体些，例如：员工提交申请，经理审批（驳回退回），出纳打款' }))
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const base = path.join(DIR, 'gen-' + stamp)
      const result = splitAndRender(r.req, base, 30)
      const mainFile = result.subs.length ? base + '-main.svg' : base + '.svg'
      const reportFile = mainFile.replace(/\.svg$/, '.report.md')
      const reqFile = base + '.req.json'
      fs.writeFileSync(reqFile, JSON.stringify(r.req, null, 2), 'utf-8')
      const out = {
        ok: true, file: path.basename(mainFile), reqFile: path.basename(reqFile),
        svg: fs.readFileSync(mainFile, 'utf-8'),
        reportMd: fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf-8') : '（无验收报告）',
        pass: result.pass, source: r.source, title: r.req.title || '未命名',
        nodes: r.req.nodes.length, lanes: (r.req.lanes || []).length,
      }
      return send(200, JSON.stringify(out), 'application/json')
    } catch (e) {
      return send(200, JSON.stringify({ ok: false, error: '服务内部出错：' + e.message.slice(0, 120) }))
    }
  }
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
