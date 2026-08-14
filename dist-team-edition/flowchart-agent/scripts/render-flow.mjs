// ============================================================
// render-flow.mjs — 自研渲染管线 CLI（V3）
// 用法: node render-flow.mjs <in.mmd> <out.svg> [--mode auto|swimlane] [--title 标题] [--sub 副标题]
// 全链路：parse-flow → layout-grid → render-svg，零外部依赖
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { parseFlow } from './parse-flow.mjs'
import { layout } from './layout-grid.mjs'
import { renderSVG } from './render-svg.mjs'

const args = process.argv.slice(2)
if (args.length < 2) {
  console.error('用法: node render-flow.mjs <in.mmd> <out.svg> [--mode auto|swimlane] [--title 标题] [--sub 副标题]')
  process.exit(1)
}
const inputFile = args[0]
const outputFile = args[1]
const getOpt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const mode = getOpt('--mode', 'auto')
const title = getOpt('--title', '')
const subtitle = getOpt('--sub', '')

const src = fs.readFileSync(inputFile, 'utf-8')
const graph = parseFlow(src)
const lay = layout(graph.nodes, graph.edges, graph.groups, graph.declaredOrder, mode)
const svg = renderSVG(lay, { classDefs: graph.classDefs, title, subtitle })

const outDir = path.dirname(outputFile)
if (outDir && !fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputFile, svg, 'utf-8')

console.log(`✅ 自研渲染成功 (mode=${lay.mode}, ${lay.nodes.length} 节点, ${lay.edges.length} 边)`)
console.log(`   输出: ${outputFile}`)
console.log(`   尺寸: ${lay.width.toFixed(0)} x ${lay.height.toFixed(0)}`)
