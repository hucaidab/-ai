# 流程图工作台 — 团队体验指南（3 分钟上手）

> 从"一句话需求"到**可编辑的专业流程图**：WorkBuddy 技能包生成 → 在线编辑器精修 → 导出 SVG/PNG/PDF。
> 本包包含：技能包（装进 WorkBuddy）、在线编辑器、3 个示例文件、一键启动脚本。

---

## 一、装什么（一次性，约 2 分钟）

### 1. 装技能包（让 WorkBuddy 学会画流程图）

把 `flowchart-agent` 文件夹复制到：

```
Windows:  C:\Users\<你的用户名>\.workbuddy\skills\
macOS:    ~/.workbuddy/skills/
```

> 路径可能因版本不同，找不到就问团队管理员。

### 2. 确认 Node.js 已装

命令行执行 `node -v`，看到版本号（如 v22.x）即可。没有就去 https://nodejs.org 装 LTS 版。

## 二、怎么用（两条路）

### 路线 A：在 WorkBuddy 对话里生成（推荐，全自动）

打开 WorkBuddy，直接说：

```
画一个采购审批流程图，采购员发起，采购经理审批，通过后财务付款
```

技能包自动完成：建模 → 布局 → 10 项验收 → 生成 `xxx.req.json` + SVG。

### 路线 B：直接玩现成的（最快上手）

打开 `examples` 文件夹，把 `.req.json` 文件复制到脚本目录（和 `preview-server.mjs` 同级）：

| 文件 | 内容 |
|------|------|
| `purchase-approval.req.json` | 采购审批流程（双部门泳道 + 判断驳回） |
| `expense-reimbursement.req.json` | 员工报销流程（多角色 + 双判断 + 数据形状） |
| `order-fulfillment.req.json` | 集团订单履约流程（多层泳道：集团→部门） |

## 三、打开在线编辑器（3 秒）

**Windows**：双击 `scripts\deploy-windows.bat` → 浏览器自动打开。
**macOS/Linux**：终端执行 `sh scripts/deploy-linux.sh`。

浏览器地址栏手动打开：

```
http://localhost:8080/editor?file=purchase-approval.req.json
```

> 文件名换成 `examples` 文件夹里的任意文件名，或你自己生成的 `xxx.req.json`。

## 四、编辑器能干什么

| 操作 | 怎么用 |
|------|--------|
| 移动节点 | 按住节点拖动 |
| 连线 | 点节点 → 出现 8 个锚点 → 按住拖到目标节点松手 |
| 改文字 | 双击节点/连线 |
| 改连线 | 选中线 → 拖端点重连 / 拖中间折点拐弯 / 双击改标签 |
| 加节点 | 工具栏"＋ 添加节点"→ 弹窗选形状（矩形/判断/起止/数据/子流程） |
| 加泳道 | 工具栏"▦ 添加泳道"→ 点头部选中 → 面板改角色/加子泳道 |
| 加备注 | 右键节点 → 写备注（📝 查看） |
| 撤销 | Ctrl+Z / Ctrl+Y |
| 删除 | 选中后按 Delete |
| 保存 | 工具栏"💾 保存"（自动 12 项验收） |
| 导出 | 保存后点 PNG / PDF 导出 |

## 五、常见问题

| 问题 | 解决 |
|------|------|
| 双击 bat 没反应 | 确认 Node.js 已装（`node -v`） |
| 8080 端口被占用 | bat 支持改端口：`deploy-windows.bat 8081` |
| 打开编辑器是空白 | Ctrl+F5 强制刷新（浏览器缓存旧版） |
| 保存提示验收不通过 | 看状态栏具体项：判断节点要有 ≥2 个带标签出口、要有开始/结束节点 |
| 保存的文件在哪 | 和编辑器脚本同目录的 `.req.json` 文件 |
| 想给同事看 | 同事浏览器访问 `http://<你的IP>:8080/editor?file=xxx.req.json`（需同一局域网 + 防火墙放行 8080） |

## 六、文件说明

```
flowchart-agent/         技能包（装进 ~/.workbuddy/skills/）
├── SKILL.md             技能定义（触发词：画流程图/泳道图…）
├── scripts/             生成管线 + 在线编辑器 + 一键启动
└── references/          技术文档
examples/                3 个已验收示例（purchase-approval 采购审批 / expense-reimbursement 报销 / order-fulfillment 多层泳道）
```

---

**有问题找技能维护人。** 代码仓库：git@github.com:hucaidab/-ai.git
