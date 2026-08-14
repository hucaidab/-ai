#!/usr/bin/env node
/**
 * quick-lint.mjs — 批量 node --check 语法检查（快速拦语法错误）
 * 用法: node quick-lint.mjs <文件或目录...>
 * 不传参数时检查当前目录下所有 .mjs/.js 文件
 * 注意：只能查纯 Node 语法；浏览器端 ESM（import './x.mjs'）语法同样适用
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'dist', 'build', 'venv', '__pycache__'])

function collectFiles(root, acc = []) {
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return acc }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const fp = path.join(root, ent.name)
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) collectFiles(fp, acc)
    } else if (/\.(mjs|js|cjs)$/.test(ent.name)) {
      acc.push(fp)
    }
  }
  return acc
}

const targets = process.argv.slice(2)
const files = []
for (const t of targets.length ? targets : ['.']) {
  const stat = fs.statSync(t)
  if (stat.isDirectory()) files.push(...collectFiles(t))
  else if (/\.(mjs|js|cjs)$/.test(t)) files.push(t)
}

let fail = 0
for (const fp of files) {
  const r = spawnSync(process.execPath, ['--check', fp], { encoding: 'utf-8' })
  if (r.status !== 0) {
    const err = (r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ')
    console.log(`❌ ${fp}: ${err}`)
    fail++
  }
}

if (fail) {
  console.log(`\n❌ ${fail}/${files.length} 个文件语法错误`)
  process.exit(1)
}
console.log(`✅ 语法检查通过（${files.length} 个文件）`)
