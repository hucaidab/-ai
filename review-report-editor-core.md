# 代码审查报告：editor-core.mjs（画布编辑器交互层）

> 审查人：火眼眼（CodeReview 技能） · 日期：2026-08-14
> 审查对象：`editor-core.mjs`（399 行，浏览器 ESM）+ 关联段 `preview-server.mjs`（/api/editor/save）
> 方法：机械检查（quick-lint ✅ / check-secrets ✅）→ 六维清单逐项 → 案例库对照

## 总体评价

经过 6 轮实战修复后，**架构质量明显在线上**：拖动零重建（案例5 教训落地 ✅）、事件委托防重绑（✅）、边 DOM→req 映射（案例3 教训落地 ✅）、保存双重路径校验（案例1 教训落地 ✅）、init 支持 reqData 注入（测试友好 ✅）。**但本次审查仍挖出 2 个 Blocker（含 1 个 XSS）和 6 个建议项**——说明"修得勤"≠"没问题"，这正是系统性审查的价值。

## 问题清单

### 🔴 Blocker（必须修复）

**1. XSS：属性面板值转义不全（只转引号，不转尖括号）**
`editor-core.mjs:235,237,238,251`

```js
<label>文本</label><input id="pText" value="${(n.action || '').replace(/"/g, '&quot;')}">
```

**为什么：** `replace(/"/g, '&quot;')` 只处理双引号。若节点 action 含 `<` `>`（如 LLM 生成的"`<审批>`"、模板里的 `&`），内插进 `panel.innerHTML` 会被解析为 HTML——`action = "<img src=x onerror=alert(1)>"` 时执行任意脚本。触发链：LLM/模板产出特殊字符 → 用户选中节点 → 注入执行。团队共享 req.json 文件后风险扩散。规范 §3.2 S4（输出转义）明确要求 `& < >` 全转义。

**建议：**
- 用统一转义函数：`const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')`
- 两个面板（L235/238/251）全部替换

**2. Escape 取消失效：`input.remove()` 触发 blur → commit 执行，取消的修改被保存**
`editor-core.mjs:163-169`

```js
const commit = () => { const v = input.value.trim(); if (v && v !== node.action) { node.action = v; ... } input.remove() }
input.addEventListener('keydown', ev => { if (ev.key === 'Enter') commit(); if (ev.key === 'Escape') input.remove() })
input.addEventListener('blur', commit)
```

**为什么：** Escape 分支调用 `input.remove()` → 元素移除**必然触发 blur 事件** → commit 再次执行 → 用户明确按 Escape 取消，输入却被保存（且 pushHistory 污染撤销栈）。这是"事件链副作用"类 bug（同案例5 同类思维陷阱）。

**建议：**
```js
let cancelled = false
input.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') commit()
  if (ev.key === 'Escape') { cancelled = true; input.remove() }
})
input.addEventListener('blur', () => { if (!cancelled) commit() })
```

### 🟡 Suggestion（应该修复）

**3. 边映射 findIndex 键不唯一（同 from→to 多边错位）**
`editor-core.mjs:89` —— `findIndex(r => r.from === e.from && r.to === e.to)` 对同 from→to 的不同 label 边（如并行的"通过/驳回"）全部映射到第一条。建议键加入 `e.label` 或用对象 Map。

**4. 点击未拖动也入撤销栈（空快照）**
`editor-core.mjs:141-147` —— pointerdown→up 无位移也 pushHistory，撤销时出现"没变化"步骤。建议 `move` 中置 `moved=true`，up 时 `if (moved) pushHistory()`。

**5. undo/redo 后 selected 状态失效**
`editor-core.mjs:39-52` —— 边选中存 idx，undo 替换 S.req 后 idx 指向错误边；节点 selected.id 可能已被删除（_updatePanel 静默 return，面板残留旧内容）。建议 undo/redo 后：节点按 id 重查，边按 from/to+label 重查，查不到则清空 selected。

**6. exportPng/exportPdf 文件名替换假设**
`editor-core.mjs:352-353` —— `/\.req\.json$/` 不匹配（如 `req-sales-order.json`）时导出错误文件名。建议服务端从 file 推导 svg 名，或统一 `.req.json` 后缀约定。

**7. Backspace 触发删除节点**
`editor-core.mjs:397` —— 页面空白按 Backspace 有浏览器导航/误删风险（且与编辑场景冲突）。建议只保留 `Delete`。

**8. 保存接口：theme 未校验 + data 无 schema 校验 + 无鉴权**
`preview-server.mjs:524-544` —— ① `payload.theme` 任意值透传（未知主题应 fallback）；② `data` 未过 `repairSchema`，格式异常依赖 500 兜底（建议保存前修复，与保存后 renderOne 行为一致）；③ 无任何鉴权，**内网部署后任何人有 URL 即可覆盖任意 .req.json**（建议部署时加简单 token，README 注明）。

### 💭 Nit（可选）

**9. 注释声称"锚点连边"未实现** `editor-core.mjs:6` —— 能力清单与实现不符（backlog 项），建议注释标注"（backlog，未实现）"避免误导。

**10. 框选实际只选中最后一个节点** `editor-core.mjs:211` —— 注释/UI 声称"框选"，行为是"选中框内最后节点"。建议明确为单选语义或补多选。

**11. `svg > g` 顶层 g=节点 的脆弱假设** `editor-core.mjs:77` —— render-svg 将来新增顶层 g（图例/分组装饰）会错位注入。建议 render-svg 输出节点时直接带 `data-id`（消除注入顺序依赖，一劳永逸）。

### ✅ Praise（表扬）

- **拖动零重建**（L135-147）：transform 直改 + 松手提交——案例5 教训的教科书级落地
- **事件委托 + _bound 防重绑**（L105-121）：innerHTML 重建不影响的正确模式
- **边 DOM→req 映射**（L89）：布局重排错位的根治方案（案例3）
- **保存双重校验**（正则 + startsWith）：案例1 路径穿越教训落地
- **init 支持 reqData 注入**：测试友好设计

## 修复优先级建议

| 优先级 | 项 | 工作量 |
|--------|-----|--------|
| P0（立即） | #1 XSS 转义、#2 Escape 取消 | 各 3-5 行 |
| P1（本周） | #3 边映射键、#4 空快照、#5 selected 失效 | 各 5-15 行 |
| P2（排期） | #6-#8、#9-#11 | 小 |

## 案例库新增建议

| 案例 | 内容 |
|------|------|
| **案例8** | innerHTML 注入转义不全（只转 `"` 不转 `<>&`）→ XSS。拦截点：安全 S4 |
| **案例9** | `input.remove()` 触发 blur 导致"取消被保存"（事件链副作用）。拦截点：正确性 C4/C7 |

## 审查记录

| 字段 | 值 |
|------|-----|
| 审查对象 | editor-core.mjs（399 行）+ preview-server.mjs 保存段 |
| 机械检查 | quick-lint 2 文件 ✅ / check-secrets ✅ |
| 问题数 | 🔴2 / 🟡6 / 💭3 / ✅5 |
| 新案例建议 | 2（#8 XSS 转义、#9 blur 副作用） |

## 修复状态（复审确认 2026-08-14）

| # | 状态 | 修复内容 | 验证 |
|---|------|---------|------|
| 🔴1 XSS 转义 | ✅ 已修复 | `escHtml` 四件套（`& < > "`）+ 面板 5 处替换（action/dept/role/fill/label） | 单测新增 escHtml 回归（16/16 全绿，含 `<img onerror>` 不注入断言） |
| 🔴2 Escape 取消 | ✅ 已修复 | `cancelled` 标志隔离——blur 仅 `!cancelled` 时 commit，Escape 置位后移除不提交 | 自检页新增第 10 项（Escape 取消不保存，10/10 全绿）；CDP 真实交互回归（点击/拖拽/零异常） |

> 🟡6 / 💭3 未在本轮处理，待作者排期（保存接口鉴权为内网部署前必办项）。
