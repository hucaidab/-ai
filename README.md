# flowchart-agent 流程图设计智能体

一句话需求 → 自动生成符合 ANSI/ISO 标准的企业流程图（SVG），支持泳道、逆向流程、自动拆图与 10 项自动验收。

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| **三级建模** | 真实 LLM（deepseek，自由自然语言）→ DSL（离线半结构化）→ 模板兜底（50 个知识库） |
| **自研渲染管线** | 解析 → 布局 → SVG 渲染，**零外部依赖**（不依赖 Mermaid/ELK/Graphviz），泳道网格布局不重叠 |
| **自动拆图** | 节点 >30 自动拆为主流程 + 子流程，链式分段 + 折叠子流程符号 + 图索引页 |
| **自动验收** | 10 项检查：起止节点 / 判断双出口 / 泳道不重叠 / 逆向虚线 / 颜色语义 / 复杂度等 |
| **网页版生成器** | `node preview-server.mjs 8080 .` → 员工浏览器打开 `http://localhost:8080/generate`，一句话生成、零命令行 |
| **在线预览** | 本地 server，SVG 预览 + 验收报告 + PNG 导出 |

## 🚀 快速开始

> 🔗 **仓库网页版（点开即看/复制地址）**：https://github.com/hucaidab/-ai

```bash
# 1. 克隆仓库
git clone git@github.com:hucaidab/-ai.git
cd -ai

# 2. （可选）配置 LLM 环境变量，接入真实大模型
setx LLM_API_KEY "sk-xxx"          # Windows（重开终端生效）
export LLM_API_KEY="sk-xxx"        # macOS / Linux（写入 ~/.bashrc 则永久）

# 3. 一句话出图（没配 key 自动降级到 DSL / 模板）
node agent-flow.mjs "画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检、应付会计、出纳"
```

## 📖 快速用法

```bash
# 单命令智能体（推荐）：自然语言 → 建模 → 出图 → 验收
node agent-flow.mjs "请假审批流程：员工提交申请，直属经理审批，HR 核对额度备案" --out my-flow

# 需求 JSON → 出图（--req 协议）
node agent-orchestrator.mjs req.json out.svg --req

# DSL 半结构化建模
node nlp-model.mjs requirement.txt req.json

# 批量出图（扫目录，自动生成断言 + 汇总报告）
node agent-batch.mjs --dir templates

# 自动拆图（>30 节点）
node split-graph.mjs req-lifecycle.json lifecycle --max 30

# 在线预览 + 一句话生成（员工零命令行入口）
node preview-server.mjs 8080 .
#   → 生成器（推荐员工用）: http://localhost:8080/generate
#   → 文件预览 + PNG 导出: http://localhost:8080
```

## 🗂 目录结构

```
├── agent-flow.mjs            # ★ 单命令智能体（一句话 → 出图）
├── agent-orchestrator.mjs    # 编排（渲染 + 10 项验收 + 报告）
├── agent-batch.mjs           # 批量出图 + 汇总报告
├── llm-model.mjs             # LLM 建模（可插拔，环境变量接入）
├── nlp-model.mjs             # DSL 建模
├── template-finder.mjs       # 模板匹配器（触发词 + 开头加权）
├── split-graph.mjs           # 自动拆图
├── parse-flow.mjs            # Mermaid 子集解析器
├── layout-grid.mjs           # 布局（auto 分层 / 泳道网格）
├── render-svg.mjs            # SVG 渲染（形状/边/配色）
├── validate.mjs              # 10 项自动验收
├── preview-server.mjs        # 在线预览 + PNG 导出
├── verify-llm.mjs            # 5 用例验收脚本
├── templates/                # 50 个知识库模板（13 业务域）
├── req-*.json / *.mmd        # 输入示例与示例图
├── flowchart-agent-spec.md   # 规格文档（设计规范/协议/验收标准）
├── LLM_CONFIG.md             # LLM 团队配置指引
└── .gitignore                # 密钥与本地文件保护
```

## 🧩 输入协议（req.json）

```json
{
  "title": "采购审批",
  "lanes": [{ "dept": "采购部", "roles": ["采购员"] }, { "dept": "财务部", "roles": ["出纳"] }],
  "nodes": [
    { "id": "N1", "dept": "采购部", "role": "采购员", "action": "填写采购申请单", "shape": "rect" },
    { "id": "N2", "dept": "采购部", "role": "采购经理", "action": "审批通过?", "shape": "diamond" }
  ],
  "edges": [
    { "from": "N1", "to": "N2", "label": "", "reverse": false },
    { "from": "N2", "to": "N1", "label": "驳回", "reverse": true }
  ]
}
```

## 📊 10 项自动验收

1. 文件可写且非空 2. 节点数 ≤ 30 3. 起止节点存在 4. 开始/结束文本 5. 泳道不重叠 6. 判断节点有双出口标签 7. 逆向边为虚线 8. 颜色语义 9. 关键文本齐全 10. 渲染无异常

## 📚 文档

- `flowchart-agent-spec.md` — 完整规格（设计规范 / 渲染管线 / 工作流协议 / 验收标准 / LLM 配置 §8.4）
- `LLM_CONFIG.md` — 团队 LLM 环境变量配置指引

## 📄 License

[MIT](LICENSE)
