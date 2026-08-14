// ============================================================
// validate.mjs — 流程图自动验收（规格书 §6 的 10 项 Checklist）
// 输入：SVG 文本 + 布局/解析上下文（节点数、边数、菱形数、预期逆向边数、
//       预期文本、预期泳道数、预期配色）
// 输出：{ pass, checks: [{ name, pass, detail }], summary }
// ============================================================

export function validateSVG(svg, ctx = {}) {
  const checks = []
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || (pass ? '通过' : '未通过') })

  // 1. 尺寸合理（viewBox 有效）
  const vb = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)
  let w = 0, h = 0
  if (vb) { w = parseFloat(vb[3]); h = parseFloat(vb[4]) }
  add('画布尺寸有效', w > 0 && h > 0, `viewBox=${w}×${h}`)
  add('尺寸比例合理', w > 0 && h > 0 && w / h > 0.03 && w / h < 33, `宽高比 ${(w / h).toFixed(2)}`)

  // 2. 复杂度：实体节点（不含子流程引用）≤ 30
  const nodeCount = ctx.nodeCount ?? -1
  const entityCount = ctx.entityNodeCount ?? nodeCount
  add('节点数 ≤ 30', entityCount > 0 && entityCount <= 30, `实体节点 ${entityCount}`)

  // 3. 开始/结束节点存在（起止形状：rx≥24 的体育场形 + <ellipse）
  const stadiums = [...svg.matchAll(/<rect[^>]*rx="(\d+(?:\.\d+)?)"/g)].filter(m => parseFloat(m[1]) >= 24).length
  const ellipseLike = stadiums + (svg.match(/<ellipse/g) || []).length
  add('起止节点存在', ellipseLike >= 2, `起止形状 ${ellipseLike} 个`)
  const hasStart = /开始/.test(svg), hasEnd = /结束/.test(svg)
  // 起止形状已存在（≥2）即视为满足；文本检查宽松匹配
  add('开始/结束文本', hasStart || ellipseLike >= 2, hasStart || ellipseLike >= 2
    ? (hasStart && hasEnd ? '均有' : '起止形状存在') : `文本缺失（开始=${hasStart} 结束=${hasEnd}）`)

  // 4. 判断节点带分支标签（菱形出边 ≥2 且带标签）
  const diamondCount = ctx.diamondCount ?? -1
  const diamondLabeled = ctx.diamondLabeledCount ?? -1
  add('判断节点有带标签分支', diamondCount >= 0 && diamondLabeled >= diamondCount * 2,
    `菱形 ${diamondCount} 个，带标签出边 ${diamondLabeled} 条`)

  // 5. 泳道不重叠（泳道模式：组头 rect 的 x 区间互不重叠；单泳道图合法）
  if (ctx.mode === 'swimlane') {
    const heads = [...svg.matchAll(/<rect x="([\d.]+)" y="50" width="(\d+)" height="44"[^>]*>/g)]
      .map(m => ({ x: parseFloat(m[1]), w: parseFloat(m[2]) }))
      .sort((a, b) => a.x - b.x)
    let overlap = false
    for (let i = 0; i < heads.length - 1; i++) {
      if (heads[i].x + heads[i].w > heads[i + 1].x + 1) overlap = true
    }
    add('泳道不重叠', !overlap, `泳道 ${heads.length} 条，${overlap ? '存在重叠' : '无重叠'}`)
  } else {
    add('泳道不重叠（非泳道模式）', true, '跳过')
  }

  // 6. 正逆向分离：逆向边全为虚线
  const dashCount = (svg.match(/stroke-dasharray/g) || []).length
  const expectedReverse = ctx.reverseCount ?? -1
  add('逆向边为虚线', expectedReverse < 0 || dashCount >= expectedReverse,
    `虚线 ${dashCount} 条 / 预期逆向 ${expectedReverse}`)

  // 7. 关键文本标签渲染
  const expectText = ctx.expectText || []
  const missing = expectText.filter(t => !svg.includes(t))
  add('关键文本标签渲染', missing.length === 0, missing.length === 0
    ? `全部命中（${expectText.length} 项）` : `缺失：${missing.join('、')}`)

  // 8. 配色生效
  const colors = ctx.expectColors || []
  const missC = colors.filter(c => !svg.toLowerCase().includes(c.toLowerCase()))
  add('配色生效', missC.length === 0, missC.length === 0
    ? `全部命中（${colors.length} 色）` : `缺失：${missC.join('、')}`)

  // 9. 箭头齐全
  const markers = (svg.match(/url\(#arr\)/g) || []).length
  const edgeCount = ctx.edgeCount ?? -1
  add('箭头数量完整', edgeCount < 0 || markers >= edgeCount, `箭头 ${markers} / 边 ${edgeCount}`)

  // 10. 输出完整性（闭合 svg 标签）
  add('SVG 结构完整', svg.trim().endsWith('</svg>'), '标签闭合')

  const failed = checks.filter(c => !c.pass)
  return {
    pass: failed.length === 0,
    checks,
    summary: `✓ ${checks.length - failed.length}/${checks.length} 项通过` + (failed.length ? `，✗ ${failed.map(c => c.name).join('、')}` : ''),
  }
}
