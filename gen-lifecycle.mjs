// 生成"订单全生命周期"合并 req（OTC + P2P + 生产领料，42 节点）用于拆图测试
import fs from 'node:fs'

const load = f => JSON.parse(fs.readFileSync('templates/' + f, 'utf-8'))
const otc = load('otc.json'), p2p = load('p2p.json'), mat = load('material-issue.json')

const px = (prefix, node) => ({ ...node, id: prefix + node.id })
const lx = (prefix, lane) => ({ ...lane })
const ex = (prefix, edge) => ({ ...edge, from: prefix + edge.from, to: prefix + edge.to })

const A = otc.nodes.map(n => px('A', n))
const B = p2p.nodes.map(n => px('B', n))
const C = mat.nodes.map(n => px('C', n))

// 调整起止：保留 AN1(start)、CN10(end)；其余 start/end 改普通矩形
A.find(n => n.id === 'AN14').shape = 'rect'
B.find(n => n.id === 'BN1').shape = 'rect'
B.find(n => n.id === 'BN18').shape = 'rect'
C.find(n => n.id === 'CN1').shape = 'rect'

const lanes = [...otc.lanes.map(l => lx('', l)), ...p2p.lanes.map(l => lx('', l)), ...mat.lanes.map(l => lx('', l))]
const nodes = [...A, ...B, ...C]
const edges = [
  ...otc.edges.map(e => ex('A', e)),
  ...p2p.edges.map(e => ex('B', e)),
  ...mat.edges.map(e => ex('C', e)),
  { from: 'AN14', to: 'BN1', label: '转采购补货', reverse: false },
  { from: 'BN18', to: 'CN1', label: '安排生产领料', reverse: false },
]

const req = { type: 'flowchart', title: '订单全生命周期（销售→采购→生产领料）', lanes, nodes, edges }
fs.writeFileSync('req-lifecycle.json', JSON.stringify(req, null, 2), 'utf-8')
console.log(`✅ 合并生成: req-lifecycle.json（${nodes.length} 节点，${edges.length} 边，${lanes.length} 泳道）`)
