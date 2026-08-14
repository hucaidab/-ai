#!/usr/bin/env node
/**
 * check-secrets.mjs — 密钥/敏感信息扫描（提交前必跑，命中 exit 1）
 * 用法: node check-secrets.mjs <文件或目录...>
 * 不传参数时扫描当前目录（跳过 node_modules/.git/.workbuddy/skills）
 *
 * 对应规范：code-review-standards.md §7 L5 自动化门槛
 */
import fs from 'node:fs'
import path from 'node:path'

const DENY_PATTERNS = [
  { name: 'API Key 赋值', re: /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i },
  { name: 'OpenAI 密钥', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: '明文密码', re: /password\s*[:=]\s*['"][^'"]{6,}['"]/i },
  { name: 'Token/密钥字段', re: /(token|secret|credential)\s*[:=]\s*['"][A-Za-z0-9._-]{16,}['"]/i },
]

const DENY_FILES = ['llm.config.json', 'llm-verify-out', '.env', '.local.json', '*.pem', '*.key', 'credentials*']

const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'dist', 'build', 'venv', '.venv', '__pycache__'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.zip', '.ico', '.woff', '.woff2'])

function collectFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const fp = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(fp)
      } else if (!SKIP_EXT.has(path.extname(ent.name).toLowerCase())) {
        out.push(fp)
      }
    }
  }
  walk(root)
  return out
}

function fileMatchesDeny(name) {
  return DENY_FILES.some((p) => {
    if (p.includes('*')) {
      const re = new RegExp('^' + p.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
      return re.test(path.basename(name))
    }
    return path.basename(name) === p || name.includes(p)
  })
}

let fails = 0
const targets = process.argv.slice(2)
const roots = targets.length ? targets : ['.']

for (const root of roots) {
  const stat = fs.statSync(root)
  const files = stat.isDirectory() ? collectFiles(root) : [root]
  for (const fp of files) {
    if (fileMatchesDeny(fp)) {
      console.log(`🔴 敏感文件: ${fp}（禁止入库，确认后移动或改名）`)
      fails++
      continue
    }
    let text
    try { text = fs.readFileSync(fp, 'utf-8') } catch { continue }
    if (text.length > 2 * 1024 * 1024) continue // 跳过大文件
    for (const p of DENY_PATTERNS) {
      if (p.re.test(text)) {
        console.log(`🔴 ${p.name}: ${fp}`)
        fails++
      }
    }
  }
}

if (fails) {
  console.log(`\n❌ 发现 ${fails} 处敏感信息，禁止提交！`)
  process.exit(1)
}
console.log('✅ 未发现敏感信息（密钥/密码/敏感文件）')
