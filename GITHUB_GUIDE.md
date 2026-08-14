# GitHub 仓库使用说明 — 流程图工作台（团队版）

> 一句话：**从 GitHub 拉代码 → 装技能包 → WorkBuddy 里生成流程图 → 浏览器在线编辑器精修 → 导出交付。**

---

## 一、仓库地址

```
HTTPS:  https://github.com/hucaidab/-ai.git
SSH:    git@github.com:hucaidab/-ai.git
```

> ⚠️ 仓库为**私有**，访问前提：
> 1. 注册 GitHub 账号
> 2. 找管理员（技能维护人）把你加为仓库协作者（Settings → Collaborators）
> 3. 本机安装 Git：https://git-scm.com

## 二、环境要求（一次性）

| 依赖 | 检查方式 | 安装 |
|------|----------|------|
| Git | `git --version` | https://git-scm.com |
| Node.js ≥ 22 | `node -v` | https://nodejs.org（LTS 版） |

## 三、首次使用流程（三步）

### 第 1 步：Clone 仓库

```bash
git clone https://github.com/hucaidab/-ai.git
cd -ai
```

### 第 2 步：安装技能包（让 WorkBuddy 学会画流程图）

把 `dist-team-edition/flowchart-agent` 整个文件夹复制到：

```
Windows:  C:\Users\<你的用户名>\.workbuddy\skills\
macOS:    ~/.workbuddy/skills/
```

> 复制后重启 WorkBuddy。路径不确定时找团队管理员确认。

### 第 3 步：生成流程图（二选一）

**路线 A：WorkBuddy 对话直接说（推荐，全自动）**

打开 WorkBuddy 输入框，直接说，例如：

```
画一个采购审批流程图，采购员发起，采购经理审批，通过后财务付款
```

技能包自动完成：需求建模 → 泳道布局 → 10 项自动验收 → 生成 `xxx.req.json` + SVG 预览。

常用触发词：`画流程图`、`泳道图`、`跨职能流程图`、`画一个XX流程`（采购到付款 / 报销 / 入职 / 请假审批 / 登录认证 / 退货退款 …）

**路线 B：用现成示例（最快上手）**

```
把 dist-team-edition/examples/ 里的 .req.json 复制到
dist-team-edition/flowchart-agent/scripts/ 目录（与 preview-server.mjs 同级）
```

| 示例文件 | 内容 |
|----------|------|
| `purchase-approval.req.json` | 采购审批流程（双部门泳道 + 判断驳回） |
| `expense-reimbursement.req.json` | 员工报销流程（多角色 + 双判断 + 数据形状） |
| `order-fulfillment.req.json` | 集团订单履约流程（多层泳道：集团 → 部门） |

## 四、打开在线编辑器（3 秒）

**Windows**：双击 `dist-team-edition/flowchart-agent/scripts/deploy-windows.bat` → 浏览器自动打开。
**macOS/Linux**：终端执行 `sh dist-team-edition/flowchart-agent/scripts/deploy-linux.sh`。

手动打开（端口被占用可改：`deploy-windows.bat 8081`）：

```
http://localhost:8080/editor?file=purchase-approval.req.json
```

`file=` 换成你自己的文件名（如 WorkBuddy 生成的 `xxx.req.json`）。

## 五、在线编辑器能力速览

| 操作 | 怎么用 |
|------|--------|
| 移动节点 | 按住节点拖动 |
| 连线 | 点节点 → 8 个锚点 → 按住拖到目标节点松手（经过的节点会高亮提示） |
| 改文字 | 双击节点 / 双击连线 |
| 改连线 | 选中线 → 拖**端点**重连其他节点 / 拖中间折点拐弯 / 双击改标签 |
| 加节点 | 工具栏"＋ 添加节点"→ 弹窗选形状（矩形/判断/起止/数据/子流程） |
| 加泳道 | 工具栏"▦ 添加泳道"→ 点泳道头部选中 → 面板改泳道名/增删角色/加子泳道（任意深度） |
| 节点归位 | 把节点拖进某泳道的角色栏 → 自动归属该部门/角色 |
| 加备注 | 右键节点 → 写备注（📝 标签查看） |
| 取消选中 | 点画布空白 |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Y |
| 删除 | 选中后按 Delete |
| 保存 | 工具栏"💾 保存"（自动 12 项验收，不通过会提示原因） |
| 导出 | 保存后点 PNG / PDF 导出 |

## 六、日常更新

```bash
git pull origin main          # 拉到最新代码
# 重新把 dist-team-edition/flowchart-agent 复制到 ~/.workbuddy/skills/（覆盖旧版）
```

## 七、仓库结构

```
-ai/
├── dist-team-edition/                  ← 团队分发包（从这里取用）
│   ├── README.md                       团队体验指南（3 分钟上手）
│   ├── examples/                       3 个已验收示例
│   └── flowchart-agent/                技能包全量（SKILL.md + scripts + references）
├── .workbuddy/skills/flowchart-agent/  ← 技能包开发工作副本
├── editor-core.mjs / editor.html       ← 在线编辑器
├── preview-server.mjs                  ← 本地预览服务
├── llm-model.mjs / parse-flow.mjs / layout-grid.mjs / render-svg.mjs  ← 生成管线
├── templates/                          ← 100 个模板库
└── test-core.mjs / cdp-*.mjs           ← 测试与回归脚本
```

## 八、常见问题

| 问题 | 解决 |
|------|------|
| clone 报 404 / Permission denied | 还没被加为协作者，找管理员 |
| 双击 bat 没反应 | 确认 Node.js 已装（`node -v`） |
| 8080 端口被占用 | `deploy-windows.bat 8081` 换端口 |
| 打开编辑器空白 | Ctrl+F5 强制刷新（浏览器缓存旧版） |
| 保存提示验收不通过 | 看状态栏：判断节点需 ≥2 个带标签出口、需有开始/结束节点 |
| 保存的文件在哪 | 编辑器脚本同目录的 `.req.json` |
| 想让同事看自己的图 | 同事浏览器访问 `http://<你的IP>:8080/editor?file=xxx.req.json`（同一局域网 + 防火墙放行 8080） |
| 生成不识别我的业务 | 需求描述补全"角色 + 步骤"，如"采购员发起，采购经理审批，通过后财务付款" |

## 九、安全须知

- **API Key 不入库**：LLM 配置走环境变量 `LLM_API_KEY`（见 `references/LLM_CONFIG.md`），`llm.config.json`（本机兜底）已被 .gitignore 排除，**严禁提交到仓库或外传**
- 本仓库为私有仓库，仅供团队成员使用

---

**维护人**：技能维护人 | **反馈渠道**：团队群 @维护人
