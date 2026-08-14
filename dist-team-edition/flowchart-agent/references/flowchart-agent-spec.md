# 流程图设计智能体（Flowchart Design Agent）开发规格书

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-08-12 |
| 文档状态 | 已评审（基于实际项目验证） |
| 适用范围 | 流程图设计智能体的需求、设计、实现与验收 |
| 配套代码 | `mermaid-render/scripts/`、工作目录下 `gen-*.mjs` 自研布局器 |

---

## 1. 背景与目标

### 1.1 背景

现有基于 Mermaid 的渲染链路存在系统性不可靠问题，经实测验证：

| 问题 | 实测结论 |
|---|---|
| 官方依赖安装 | `beautiful-mermaid` 走 npm 默认源在国内网络下安装卡死；须用 `registry.npmmirror.com` |
| ESM 兼容 | 原包为 ESM-only，`require()` 必报错，须用 `import` 封装脚本 |
| 中文渲染 | 原版对 CJK subgraph 标题/子图布局有缺陷，须用社区 fork `@ktrysmt/beautiful-mermaid` |
| 泳道（跨职能）布局 | ELK 布局引擎按"拓扑层"打包子图，泳道会乱序/重叠；Graphviz（WASM）cluster 盒子在带回边流程下相互穿透 |
| 隐形边 | Mermaid `~~~` 在 `@ktrysmt/beautiful-mermaid` 解析中被丢弃且破坏后续节点标签，不可用于强制顺序 |

### 1.2 目标

开发一套**专用的流程图设计智能体**，具备：

1. 将自然语言/结构化描述转化为符合 **ANSI/ISO 流程图符号规范**的专业流程图；
2. 支持**多角色/多部门泳道图**（两级：部门 → 岗位），保证泳道不重叠、正逆向流程清晰；
3. 输出 **SVG + 可维护源码**（Mermaid / DOT / 自研布局脚本数据表）；
4. 具备**自动化自检与验收**能力（形状、配色、流向、泳道、逆向流程）。

---

## 2. 流程图设计规范（Requirements）

### 2.1 支持的图表类型

| 类型 | 优先级 | 说明 |
|---|---|---|
| 流程图 Flowchart | P0 | 核心能力，含泳道/跨职能图 |
| 时序图 Sequence | P0 | 多角色消息交互（ERP 场景推荐） |
| 状态图 State | P1 | 状态机建模 |
| 类图 / ER 图 | P1 | 面向对象 / 数据库设计 |
| XY 数据图表 | P2 | 柱状/折线/混合 |

### 2.2 流程图形状规范（ANSI/ISO 符号）

| 语义 | 形状 | Mermaid 语法 | 自研布局器形状 |
|---|---|---|---|
| 开始 / 结束 | 体育场形 | `([text])` | ellipse |
| 处理（流程） | 矩形 | `[text]` | rect |
| 判断 | 菱形 | `{text}` | diamond |
| 子流程 | 双矩形 | `[[text]]` | box + peripheries=2 |
| 数据容器 | 圆柱 | `[(text)]` | cylinder |
| 备注 / 注释 | 虚线框 | classDef `stroke-dasharray` | dashed box |

**强制规则：**
- 判断节点（菱形）**必须**有两个及以上带标签出口（是/否、通过/驳回等）；
- 主流程**单一入口、单一出口**（开始 → 结束），异常分支最终回到主流程或显式终止；
- 同级节点流向一致（TD 自上而下 或 LR 自左而右），禁止无意义回折；
- 子流程（双矩形）表示"封装的处理单元"，可在另一张图展开其内部步骤。

### 2.3 布局规范

| 项 | 规范 |
|---|---|
| 常规流程图方向 | 业务流程优先 TD（自上而下）；系统架构/演示优先 LR |
| 泳道图（跨职能） | 推荐**网格坐标法**（自研布局器）：列=部门/角色，行=流程顺序，坐标完全可控 |
| 泳道分级 | 一级=角色；二级=部门（大列）+ 岗位（子列）；可内嵌更深审批链（如经理→总监会签） |
| 连线路由 | 正交（orthogonal）：同岗位垂直直连；同部门跨岗位走子列间隙；跨部门走部门间通道 |
| 正逆向分离 | 正向边走源节点右侧/下方，逆向/异常边走左侧通道绕行，避免重叠 |
| 间距参数 | padding≥40，nodeSpacing≥32，layerSpacing≥52，rowSpacing≈128（泳道） |

### 2.4 配色规范

- **双语义体系**：形状表达"语义"（起止/处理/判断/子流程/数据/备注），颜色表达"角色或部门"；
- 内置 15 主题（github-light / tokyo-night / nord / catppuccin 等），技术文档默认 `github-light`；
- 角色色建议（浅色主题）：用户=红、前端=蓝、后端/核心=紫、数据=绿、外部=橙、辅助=灰；
- 对比度要求：深色文字配浅色填充，白色文字配深色填充；相邻泳道色相必须可区分；
- 判断节点统一黄色系（`#fff8c5` / `#9a6700`），开始/结束统一绿色（`#1f883d`）。

### 2.5 文本与命名

- 节点 ID 使用语义化英文命名（`P1/SubmitPR`），唯一且不与子图 ID 冲突；
- 标签默认中文，岗位/角色信息用前缀（`采购员：提交采购申请`）或子列头表达；
- 长文本用 `<br/>` 换行，单行不超过 12 个中文字符（节点宽度约束）；
- 特殊字符（`"` `()` `&` 等）在 Mermaid 标签中须加引号包裹。

### 2.6 复杂度控制

- 单图节点 ≤ 30，超过则拆分为"主流程 + 子流程"多张图；
- 角色 > 7 时按部门归并泳道（策略②），岗位细节放入部门内子列；
- 交互密集型流程（消息往来多）改用**时序图**表达。

---

## 3. 渲染能力与依赖管理

### 3.1 渲染管线（已验证可用）

```
Mermaid 源码 (.mmd)
  ├─ render-esm.mjs ── @ktrysmt/beautiful-mermaid@1.5.2 ── ELK.js ── SVG   （常规流程图/时序图等）
DOT 源码 (.dot)
  └─ render-dot.mjs ── @viz-js/viz (WASM Graphviz) ── SVG                    （无回边泳道等简单图）
自研泳道布局器 (gen-*.mjs)
  └─ 网格坐标法：部门列 × 流程行 ── 直接生成 SVG                              （复杂泳道图，推荐）
```

### 3.2 渲染器选型决策矩阵

| 场景 | 推荐渲染器 | 理由 |
|---|---|---|
| 标准流程图/时序图/状态图 | `render-esm.mjs`（ELK） | 成熟、CJK 正常、同步渲染 |
| 简单无回边泳道 | `render-dot.mjs`（Graphviz） | cluster 成列整齐 |
| **复杂泳道（带回边）** | **自研网格布局器** | ELK/Graphviz 均会乱序/重叠 |
| 终端展示 | `renderMermaidASCII` | Unicode/ASCII 双模式 |

### 3.3 依赖安装规范

- 一律使用镜像源：`--registry https://registry.npmmirror.com --no-audit --no-fund`；
- ESM-only 包（beautiful-mermaid 系）必须用 `.mjs` 脚本 + `import`，禁止 `require`；
- 路径传参用 Windows 风格绝对路径（`C:/...`），Git Bash 的 `/c/...` 会被 Node 误解；
- SVG→PNG 离线校验须先移除 Google Fonts `@import`（离线无法加载导致文字缺失），并开启 `loadSystemFonts`。

### 3.4 已知限制（规避方案）

| 限制 | 规避 |
|---|---|
| ELK 子图按拓扑层打包 → 泳道乱序/重叠 | 复杂泳道一律走自研网格布局器 |
| Graphviz cluster 盒子相互穿透 | 仅用于无回边简单图 |
| Mermaid `~~~` 隐形边解析失败 | 用自研布局器的手写坐标/通道约束代替 |
| 中文文本宽度测量 | 节点宽按"字符数 × 13px"估算，留 20% 余量 |

---

## 4. 智能体工作流与协议

### 4.1 输入协议

支持三种输入形态：

1. **自然语言**：如"画一个用户登录认证流程图，要标准符号、多角色泳道"；
2. **结构化 JSON**：
```json
{
  "type": "flowchart",
  "title": "采购到付款 P2P",
  "lanes": [ { "dept": "采购部", "roles": ["采购员","采购经理"] } ],
  "nodes": [ { "id": "P1", "role": "采购员", "action": "提交采购申请", "shape": "rect" } ],
  "edges": [ { "from": "P1", "to": "P2", "label": "申请", "reverse": false } ]
}
```
3. **源码**：直接给出 `.mmd` / `.dot` 要求渲染或修改。

### 4.2 处理流程（Agent Workflow）

```
Step 1 需求分析
  ├─ 确定图表类型（流程图/时序图/泳道图…）
  ├─ 提取角色/部门/岗位清单（>7 角色 → 按部门归并）
  └─ 提炼流程主线 + 逆向/异常分支
Step 2 设计
  ├─ 分配节点与形状（ANSI/ISO 规范）
  ├─ 确定布局（方向、泳道分级、间距）
  └─ 确定配色（语义 + 角色双体系）
Step 3 渲染
  └─ 按选型矩阵选择渲染器（复杂泳道 → 自研网格布局器）
Step 4 自检（自动化）
  ├─ 形状/配色/标签存在性校验
  ├─ 泳道容器坐标不重叠校验
  ├─ 正逆向边数量与虚线校验
  └─ 复杂度（节点数 ≤ 30）校验
Step 5 交付
  └─ SVG + 源码（mmd/dot/脚本数据表）+ 校验报告
```

### 4.3 输出协议

| 产物 | 格式 | 说明 |
|---|---|---|
| 成品图 | `diagram-<名称>.svg` | 矢量、可缩放、可嵌入 |
| 源码 | `diagram-<名称>.mmd` / `.dot` | 可版本控制、可维护 |
| 布局器脚本 | `gen-<流程>.mjs` | 数据驱动（DEPTS/ROWS/EDGES 三表），换流程只改数据 |
| 校验报告 | 文本输出 | 形状/配色/泳道/逆向/复杂度命中数 |

---

## 5. 技术架构

```
┌────────────────────────────────────────────────┐
│  Agent 编排层（需求分析 → 设计 → 渲染 → 验收）  │
├──────────────┬──────────────┬──────────────────┤
│  解析层       │  布局层       │   渲染层          │
│ parseMermaid │ ELK.js       │ SVG 生成器        │
│ parseMermaid │ 自研网格坐标  │ ASCII 生成器      │
│ (DOT)        │ Graphviz     │ PNG 转换(resvg)   │
├──────────────┴──────────────┴──────────────────┤
│  主题层（15 内置 + 自定义 bg/fg/line/accent…）  │
├────────────────────────────────────────────────┤
│  校验层（存在性 grep + 坐标解析 + 计数断言）     │
└────────────────────────────────────────────────┘
```

模块职责：
- **解析层**：统一解析 Mermaid/DOT 为节点-边-子图结构；
- **布局层**：复杂泳道必须用网格坐标法（列=泳道，行=流程步），正交路由；
- **渲染层**：形状按语义、颜色按角色、边按正逆向（虚线=逆向）；
- **校验层**：所有验收断言自动化（见 §6）。

---

## 6. 质量验收标准（Checklist）

| # | 验收项 | 方法 | 通过标准 |
|---|---|---|---|
| 1 | 开始/结束存在 | grep 起止节点文本 | 各有 ≥1 |
| 2 | 判断节点带分支标签 | grep 是/否、通过/驳回 | 每菱形 ≥2 出口标签 |
| 3 | 语义形状齐全 | 统计 polygon/rect/ellipse/双框/圆柱 | 与设计一致 |
| 4 | 角色/部门齐全 | grep 部门头+岗位子列头 | 全部命中 |
| 5 | 泳道不重叠 | 解析 subgraph/cluster 容器坐标 | 无纵向/横向重叠 |
| 6 | 正逆向分离 | 统计 stroke-dasharray 边 | 逆向边全为虚线 |
| 7 | 标签渲染 | grep 节点动作文本 | 全部命中（≥1 次） |
| 8 | 复杂度 | 统计节点数 | ≤30 |
| 9 | 配色生效 | grep 主题/角色色值 | 每类 ≥1 命中 |
| 10 | 尺寸合理 | 解析 viewBox | 无 0 尺寸 / 异常比例 |

---

## 7. 演进路线

| 版本 | 阶段 | 内容 |
|---|---|---|
| V1 | 已完成 | Mermaid + `@ktrysmt/beautiful-mermaid`（ELK）常规图渲染；npm 镜像；ESM 封装 |
| V2 | 已完成 | 自研泳道布局器（网格坐标法、两级部门→岗位、正逆向通道）；P2P/OTC 示例 |
| V3 | 已完成 | **统一自研渲染管线（零外部依赖）**：`parse-flow.mjs`（Mermaid flowchart 子集解析，支持中文 id）+ `layout-grid.mjs`（auto 拓扑分层 / swimlane 泳道，含部门色板）+ `render-svg.mjs`（形状/正交路由/classDef）+ `render-flow.mjs`（CLI）+ `agent-orchestrator.mjs`（智能体编排：需求 JSON/mmd → 渲染 → 10 项自动验收 → SVG+报告）+ `validate.mjs`（验收实现）。三例测试 12/12 通过（登录图 auto、P2P 泳道、需求 JSON 协议） |
| V4 | 已完成（深化） | **智能体化**：`nlp-model.mjs`（半结构化 DSL → req.json）+ `agent-batch.mjs`（批量出图+自动断言+汇总）+ `preview-server.mjs`（在线预览+PNG 导出）+ **M1 知识库**：`templates/` 8 模板（p2p/otc/onboarding/expense/leave/login-auth/material-issue/return-refund，带 meta.triggers）+ `template-finder.mjs`（触发词匹配+变量覆盖）+ **M2 自动拆图**：`split-graph.mjs`（最长关键路径→分支簇→链式分段→主图折叠 [[子流程]]+子图+index.html 索引）+ **M3 LLM 建模**：`llm-model.mjs`（自由自然语言 → req.json，JSON Schema+few-shot，`llm.config.json` 配置，降级链 LLM→DSL→模板）+ **M4 单命令**：`agent-flow.mjs`（一句话 → 建模→渲染/拆图→验收→预览）。验收：8 模板批量 12/12；42 节点订单全生命周期自动拆主图+子图 12/12；单命令端到端 12/12 |

---

## 8. 附录

### 8.1 命令速查

```bash
# 常规图渲染（ESM）
node render-esm.mjs <in.mmd> <out.svg> github-light '{"padding":50,"nodeSpacing":36,"layerSpacing":56,"thoroughness":5}'
# Graphviz 渲染
node render-dot.mjs <in.dot> <out.svg> dot
# 自研泳道图（数据驱动）
node gen-<流程>.mjs
# ★ 自研渲染管线（V3，零外部依赖）
node render-flow.mjs <in.mmd> <out.svg> [--mode auto|swimlane] [--title 标题]
# ★ 智能体编排（渲染 + 自动验收 + 报告）
node agent-orchestrator.mjs <in.mmd|req.json> <out.svg> [--req] [--mode auto|swimlane]
    [--expect-text "开始,结束,采购部"] [--expect-reverse 3] [--expect-colors "#0969da,#1f883d"]
# ★ 需求自动建模（NL/DSL → req.json）
node nlp-model.mjs <需求.txt> <req.json>
# ★ 批量出图（自动断言 + 汇总报告）
node agent-batch.mjs req1.json req2.json ...   # 或 --dir <目录>
# ★ 在线预览（含 PNG 导出）
node preview-server.mjs [port=8080] [dir]      # 打开 http://localhost:8080
# ★ LLM 自由自然语言建模（团队用环境变量 LLM_API_KEY/LLM_BASE_URL/LLM_MODEL 启用；见 LLM_CONFIG.md；未配置自动降级 DSL/模板）
node llm-model.mjs "画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检..." [--out req.json]
# ★ 自动拆图（>30 节点 → 主图 + 子图 + 索引页）
node split-graph.mjs <req.json> <outBase> [--max 30]
# ★ 单命令智能体（一句话 → 建模 → 渲染/拆图 → 验收 → 交付）
node agent-flow.mjs "自然语言需求" [--out 前缀] [--max 30]
# 依赖安装（镜像）
npm install <pkg> --registry https://registry.npmmirror.com --no-audit --no-fund
```

### 8.2 本项目产出索引

| 文件 | 说明 |
|---|---|
| `diagram-login-auth.{mmd,svg}` | 登录认证流程图（标准符号 + 角色标注） |
| `diagram-erp-p2p-roles.svg` / `gen-p2p-swimlane.mjs` | P2P 部门+岗位两级泳道图（含生产使用环节） |
| `diagram-otc-swimlane.svg` / `gen-otc-swimlane.mjs` | 销售订单 OTC 8 岗位泳道图（含总监会签） |
| `diagram-erp-p2p.mmd/.svg` | P2P 时序图（7 角色） |
| `diagram-p2p-reverse-flow.{mmd,svg}` | 逆向异常处理流程图 |
| `parse-flow.mjs` | 自研 Mermaid flowchart 子集解析器（零依赖，中文 id） |
| `layout-grid.mjs` | 自研布局器（auto 拓扑分层 / swimlane 泳道） |
| `render-svg.mjs` | 自研 SVG 渲染器（形状/部门色板/classDef/正交路由） |
| `render-flow.mjs` | 自研渲染管线 CLI（V3） |
| `agent-orchestrator.mjs` | 智能体编排（需求 JSON/mmd → 渲染 → 验收 → 报告） |
| `validate.mjs` | 10 项自动验收实现 |
| `req-util.mjs` | 需求 JSON → Mermaid 公共模块 |
| `nlp-model.mjs` | 需求自动建模（NL/DSL → req.json） |
| `agent-batch.mjs` | 批量出图 + 自动断言 + 汇总报告 |
| `preview-server.mjs` | 在线预览服务（SVG 预览/报告/PNG 导出） |
| `req-purchase-approval.json` | 需求 JSON 输入协议示例 |
| `req-sales-order.txt/.json` | 自然语言 DSL 建模示例（销售订单） |
| `req-sales-order.svg` / `req-purchase-approval.svg` | 批量出图产物 |
| `batch-report.md` | 批量汇总报告 |
| `templates/`（8 个 .json） | 知识库模板（p2p/otc/onboarding/expense/leave/login-auth/material-issue/return-refund） |
| `template-finder.mjs` | 模板匹配器（触发词打分 + 变量覆盖"X 改叫 Y"） |
| `split-graph.mjs` | 自动拆图（关键路径/分支簇/链式分段/索引页） |
| `llm-model.mjs` / `llm.config.json` | LLM 自然语言建模（**团队用环境变量启用**，配置仅本机兜底，降级链 LLM→DSL→模板） |
| `LLM_CONFIG.md` | 团队环境变量配置指引（Win/macOS/Linux/CI + 验证 + 安全红线） |
| `.gitignore` | 忽略密钥配置（llm.config.json）与依赖/日志 |
| `agent-flow.mjs` | 单命令智能体（一句话 → 出图） |
| `v4-plan.md` | V4 深化计划 |
| `req-lifecycle.json` / `gen-lifecycle.mjs` | 42 节点拆图测试用例（订单全生命周期） |
| `lifecycle-main.svg` / `lifecycle-sub1.svg` / `lifecycle-index.html` | 自动拆图产物（主图+子图+索引） |
| `flowchart-agent-spec.html` | 规格文档 HTML 版（浏览器阅读/打印） |
| `flowchart-agent-spec.html` | 规格文档 HTML 版（浏览器阅读/打印） |
| `mermaid-render/scripts/render-esm.mjs` | Mermaid→SVG（@ktrysmt + ELK） |
| `mermaid-render/scripts/render-dot.mjs` | DOT→SVG（@viz-js/viz WASM） |
| `LLM_CONFIG.md` | 团队环境变量配置指引（独立文件，内容与 §8.4 一致） |

### 8.3 智能体系统提示词草案（可直接使用）

> 你是一位专业的流程图设计智能体。你严格遵守 ANSI/ISO 流程图符号规范：开始/结束=体育场形、处理=矩形、判断=菱形（必须带 ≥2 个带标签出口）、子流程=双矩形、数据=圆柱、备注=虚线框。颜色语义双体系：形状表达类型，颜色表达角色/部门。单图节点不超过 30 个，超过则拆图。多角色（>7）按部门归并泳道；复杂泳道必须使用网格坐标法布局，保证泳道不重叠、正逆向通道分离（正向实线走右通道、逆向虚线走左通道）。渲染前先自检：开始/结束存在、判断有分支标签、泳道无重叠、逆向边为虚线、角色/部门齐全。交付 SVG + 可维护源码 + 校验报告。

### 8.4 LLM 环境变量配置（团队规范）

> 本节为 `LLM_CONFIG.md` 的正式附录版本。**团队统一使用环境变量接入 LLM，禁止把 api_key 提交进代码库。**

**需要设置的环境变量：**

| 变量 | 必填 | 说明 | 示例 |
|---|---|---|---|
| `LLM_API_KEY` | 是 | API 密钥 | `sk-xxxxxxxx` |
| `LLM_BASE_URL` | 否 | API 网关地址（默认 deepseek） | `https://api.deepseek.com` |
| `LLM_MODEL` | 否 | 模型名（默认 deepseek-chat） | `deepseek-chat` |

> 代码读取优先级：环境变量 > `llm.config.json`（后者已被 .gitignore 忽略，仅本机临时用）。

**Windows（本机永久生效）：**
```bash
setx LLM_API_KEY "sk-xxxxxxxx"
setx LLM_BASE_URL "https://api.deepseek.com"
setx LLM_MODEL "deepseek-chat"
```
> `setx` 设置后需重新打开终端才生效。仅当前会话用：`export LLM_API_KEY="sk-xxxxxxxx"`。

**macOS / Linux（永久生效）：**
```bash
echo 'export LLM_API_KEY="sk-xxxxxxxx"' >> ~/.zshrc   # zsh；bash 用 ~/.bashrc
echo 'export LLM_BASE_URL="https://api.deepseek.com"' >> ~/.zshrc
source ~/.zshrc
```

**CI / 流水线（GitHub Actions 示例）：**
```yaml
env:
  LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
  LLM_BASE_URL: ${{ secrets.LLM_BASE_URL }}
  LLM_MODEL: deepseek-chat
```

**验证是否生效：**
```bash
node -e "import('./llm-model.mjs').then(m => { const c = m.loadLLMConfig(); console.log('base_url:', c.base_url); console.log('model:', c.model); console.log('api_key:', c.api_key ? '已配置(' + c.api_key.slice(0,4) + '***)' : '❌ 未配置'); })"
```

**没有 key 时的降级行为：**
`llm-model.mjs` 自动降级：**LLM → DSL 规则解析（nlp-model）→ 知识库模板（template-finder）**。无 key 也能用模板/DSL 出图，配了 key 则自由自然语言直接建模，两者都不影响 `agent-flow.mjs` 单命令使用。

**安全红线：**
- ❌ 不要把 api_key 写进任何提交到 git 的文件
- ✅ 仓库已含 `.gitignore` 忽略 `llm.config.json`，提交前先 `git status` 确认
- ✅ key 泄露后立即到平台后台吊销并重新生成
