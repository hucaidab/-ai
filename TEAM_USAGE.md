# flowchart-agent 团队使用手册

> 面向团队成员（产品/需求/项目同学）的实操指南。5 分钟上手，一句话出图。

## 0. 这是什么

一句话需求 → 自动生成标准企业流程图（SVG）。内置 50 个常见流程模板（采购/销售/报销/入职/请假/MES 生产制造…），支持泳道、审批驳回逆向线、自动拆图、10 项自动验收。

```
需求一句话 → (LLM/DSL/模板) 建模 → 出图 → 10 项验收 → SVG + 报告
```

## 1. 你（团队负责人）要做的 3 件事

### ① 分发仓库地址（一次）

把仓库地址发到团队群：

```bash
git clone git@github.com:hucaidab/-ai.git
```

> 没有 GitHub 账号的同学：注册后把 SSH 公钥发给你，或直接走 `LLM_CONFIG.md` 里的环境变量方案。

### ② 告知成员：key 自己配（无需你发）

没有 API key 也能用（自动降级到模板/DSL），但**配了 key 才能解析任意自然语言**（质量最好）。

**你只需要在群里说一句**：去 DeepSeek 开放平台（platform.deepseek.com）注册申请 API key，在自己电脑上 `setx LLM_API_KEY "sk-xxx"`。key 各自保管、禁止共享、禁止发群里。

### ③ 把 WorkBuddy 技能包同步给成员（可选，对话式使用）

如果你的团队用 WorkBuddy 对话干活，把 `~/.workbuddy/skills/flowchart-agent/` 整个目录拷给成员放到同样位置，他们在对话里说"画个流程图"就能触发（见 §4）。

## 2. 成员上手（5 分钟）

```bash
# 1. 克隆
git clone git@github.com:hucaidab/-ai.git && cd -ai

# 2. 确认 Node 环境
node -v        # 需要 v18+（推荐 22）

# 3.（可选）配自己的 LLM key
# 去 platform.deepseek.com 注册 → 创建 API key → 在自己电脑上执行：
setx LLM_API_KEY "sk-xxx"   # Windows（重开终端生效）
export LLM_API_KEY="sk-xxx" # macOS/Linux
# key 自己保管，禁止共享/发群里/提交代码库

# 4. 验证
node agent-flow.mjs "请假审批流程：员工提交申请，直属经理审批，HR 核对额度备案" --out test-flow
# → 看到 12/12 即成功，打开 test-flow.svg 查看
```

## 3. 日常使用（命令行）

| 需求 | 命令 |
|------|------|
| **一句话出图**（推荐） | `node agent-flow.mjs "采购到付款流程，要体现审批驳回" --out xxx` |
| **用 DSL 精确控制** | 写 `req.txt`（见 §5），`node nlp-model.mjs req.txt req.json && node agent-flow.mjs "标题" --req req.json --out xxx` |
| **批量出图** | 把多个需求 json 放一个目录，`node agent-batch.mjs --dir ./需求目录` |
| **在线预览/导出 PNG** | `node preview-server.mjs 8080 .` → 浏览器打开 http://localhost:8080 |
| **大流程自动拆图** | `node split-graph.mjs big.json big --max 30` → 主图+子图+索引页 |

## 4. 日常使用（WorkBuddy 对话）

装了技能包后，直接在对话里说：

> "画一个手机 MES 生产制造流程图，7 个部门泳道"
> "报销流程，出纳改叫资金专员"
> "员工入职流程怎么走"

技能自动触发 → 建模 → 出图 → 验收，SVG 直接在对话里展示。

## 5. DSL 快速写法（不配 LLM 时用）

```text
标题: 差旅报销
部门: 员工 (员工)
部门: 部门经理 (经理)
部门: 财务 (出纳)
开始: 员工.提交报销单
判断: 经理.审批通过?
步骤: 出纳.打款
结束: 出纳.完成
流程: 提交报销单 → 审批通过? --通过--> 打款
流程: 审批通过? --驳回--> 提交报销单 (逆向)
```

## 6. 团队协作规范

- **产物命名**：`<项目>-<流程>.svg`（如 `mes-生产制造.svg`），`--out` 指定，便于检索
- **需求源文件**：DSL 文本（`.txt`）与 req.json 一起保留，图可复现
- **LLM key 各自管理**：只在自己机器上 `setx`/`export`，严禁共享、严禁发到群里或提交到任何仓库
- **模板扩充**：新流程稳定后可存为模板（`templates/xxx.json` + 触发词），按 `gen-more-templates.mjs` 的写法批量加，加完跑 `node agent-batch.mjs --dir templates` 验收
- **代码更新**：`git pull` 拉最新（脚本/模板会持续更新）

## 7. FAQ

| 问题 | 解决 |
|------|------|
| 没配 key 能用吗？ | 能。自动降级：LLM → DSL → 50 模板兜底 |
| key 从哪来？ | 自己注册 DeepSeek 开放平台（platform.deepseek.com）创建，**别问同事要，别发群里** |
| 出图验收没过？ | 看 `xxx.report.md` 哪项失败，最常见是缺起止节点/判断缺出口标签 |
| 图太长？ | 自动拆图（>30 节点），或手动 `split-graph.mjs --max 30` |
| 想用别的模型？ | 自己配 `setx LLM_BASE_URL "https://..."` + `setx LLM_MODEL "模型名"` |
| key 泄露了？ | 到平台吊销重建一个，`LLM_CONFIG.md` 有安全红线说明 |
