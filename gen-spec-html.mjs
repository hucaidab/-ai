// ============================================================
// Markdown 子集 → 专业 HTML 文档转换器
// 支持：标题(#/##/###)、表格、代码块(```)、有序/无序列表、
//       行内代码(`)、粗体(**)、段落
// 输出：浅色 GitHub 风格 + TOC + 打印优化
// ============================================================
import fs from 'node:fs'

const src = fs.readFileSync('C:/Users/1/WorkBuddy/2026-08-12-15-26-19/flowchart-agent-spec.md', 'utf-8')
const lines = src.split(/\r?\n/)

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 行内格式：`code` → <code>，**bold** → <strong>
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}
function inlineCodeOnly(s) {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>')
}

const toc = []
let html = ''
let i = 0
let inCode = false
let codeLang = ''
let codeBuf = []
let tableBuf = []

function flushTable() {
  if (!tableBuf.length) return
  // tableBuf: rows of cells
  const rows = tableBuf
  html += '<div class="tbl-wrap"><table>\n'
  rows.forEach((cells, ri) => {
    const tag = ri === 0 ? 'th' : 'td'
    html += '  <tr>' + cells.map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join('') + '</tr>\n'
  })
  html += '</table></div>\n'
  tableBuf = []
}

function flushCode() {
  if (!inCode) return
  const lang = codeLang === 'bash' ? 'bash' : codeLang === 'json' ? 'json' : ''
  html += `<pre><code class="lang-${lang || 'text'}">${esc(codeBuf.join('\n'))}</code></pre>\n`
  codeBuf = []
  inCode = false
}

for (; i < lines.length; i++) {
  const line = lines[i]
  const t = line.trim()

  // 代码块
  if (t.startsWith('```')) {
    if (!inCode) { flushTable(); inCode = true; codeLang = t.slice(3).trim(); continue }
    flushCode(); continue
  }
  if (inCode) { codeBuf.push(line); continue }

  // 表格
  if (t.startsWith('|') && t.endsWith('|')) {
    const cells = t.split('|').slice(1, -1).map(c => c.trim())
    // 分隔行 |---|---| 跳过
    if (cells.every(c => /^:?-+:?$/.test(c))) continue
    tableBuf.push(cells)
    continue
  } else if (tableBuf.length) { flushTable() }

  // 标题
  if (/^#{1,4}\s/.test(t)) {
    const level = t.match(/^#+/)[0].length
    const text = t.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '')
    if (level <= 3) {
      const id = 'sec-' + text.replace(/[^\w\u4e00-\u9fa5]+/g, '-').toLowerCase()
      toc.push({ level, text, id })
      html += `<h${level} id="${id}">${inline(text)}</h${level}>\n`
    } else {
      html += `<h${level}>${inline(text)}</h${level}>\n`
    }
    continue
  }

  // 列表
  if (/^\s*[-*]\s+/.test(line)) {
    html += `<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>\n`
    continue
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    const text = t.replace(/^\d+\.\s+/, '')
    html += `<li value="${t.match(/^\d+/)[0]}">${inline(text)}</li>\n`
    continue
  }

  // 引用
  if (t.startsWith('> ')) { html += `<blockquote>${inline(t.slice(2))}</blockquote>\n`; continue }

  // 空行
  if (!t) { html += '\n'; continue }

  // 段落
  html += `<p>${inline(t)}</p>\n`
}
flushTable()
flushCode()

// 组装 TOC
let tocHtml = '<nav class="toc"><div class="toc-title">目录</div>'
for (const h of toc) {
  const pad = h.level === 2 ? '' : ' style="padding-left:14px"'
  tocHtml += `<div${pad}><a href="#${h.id}">${esc(h.text)}</a></div>`
}
tocHtml += '</nav>'

const out = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>流程图设计智能体开发规格书 v1.0</title>
<style>
  :root{
    --bg:#ffffff; --fg:#1f2328; --muted:#57606a; --border:#d0d7de;
    --accent:#0969da; --accent-bg:#ddf4ff; --code-bg:#f6f8fa; --tbl-h:#f6f8fa;
  }
  *{box-sizing:border-box}
  body{margin:0;background:#f6f8fa;color:var(--fg);font-family:'Microsoft YaHei','Segoe UI',system-ui,sans-serif;line-height:1.7;font-size:14.5px}
  .wrap{max-width:1000px;margin:0 auto;padding:32px 20px 80px}
  .doc{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:40px 48px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  h1{font-size:26px;margin:0 0 4px;border-bottom:3px solid var(--accent);padding-bottom:12px}
  h2{font-size:20px;margin:36px 0 12px;padding-top:12px;border-top:1px solid var(--border)}
  h2:first-of-type{border-top:none}
  h3{font-size:16px;margin:22px 0 8px;color:#0a3069}
  h4{font-size:14.5px;margin:16px 0 6px}
  p{margin:8px 0}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  code{background:var(--code-bg);border:1px solid #e1e4e8;border-radius:4px;padding:1px 5px;font-size:12.5px;font-family:Consolas,'Courier New',monospace}
  pre{background:#0d1117;color:#e6edf3;border-radius:8px;padding:14px 16px;overflow-x:auto;line-height:1.55}
  pre code{background:none;border:none;color:inherit;padding:0;font-size:12.5px}
  .tbl-wrap{overflow-x:auto;margin:10px 0}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  th,td{border:1px solid var(--border);padding:7px 12px;text-align:left;vertical-align:top}
  th{background:var(--tbl-h);font-weight:600}
  tr:nth-child(even) td{background:#fafbfc}
  blockquote{margin:10px 0;padding:6px 14px;border-left:4px solid var(--accent);background:var(--accent-bg);border-radius:0 6px 6px 0;color:#0a3069}
  li{margin:3px 0}
  .toc{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:18px 0;column-count:2;column-gap:32px;font-size:13px}
  .toc-title{font-weight:700;color:var(--muted);margin-bottom:6px;column-span:all}
  .toc a{display:block;padding:1px 0;color:var(--fg)}
  .toc a:hover{color:var(--accent)}
  @media print{
    body{background:#fff}
    .wrap{padding:0;max-width:none}
    .doc{border:none;box-shadow:none;padding:20px}
    .toc{column-count:1}
    pre{background:#f6f8fa;color:#24292f}
  }
  @media (max-width:720px){
    .doc{padding:24px 18px}
    .toc{column-count:1}
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="doc">
  ${html}
  </div>
</div>
</body>
</html>`

fs.writeFileSync('C:/Users/1/WorkBuddy/2026-08-12-15-26-19/flowchart-agent-spec.html', out, 'utf-8')
console.log('✅ HTML 规格文档生成: flowchart-agent-spec.html (' + Math.round(out.length / 1024) + ' KB)')
