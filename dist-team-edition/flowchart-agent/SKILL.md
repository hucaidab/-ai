---
name: flowchart-agent
description: 流程图设计智能体——从自然语言/需求一句话生成专业流程图（ANSI/ISO 标准符号、部门+岗位两级泳道、正逆向流程分离、>30 节点自动拆图、10 项自动验收、在线预览）。自研零依赖渲染管线（解析→网格布局→SVG），配 LLM_API_KEY 后可用大模型解析任意自然语言，无 key 自动降级到知识库模板/DSL。触发词：画流程图、流程图、泳道图、跨职能流程图、流程设计、画一个XX流程、采购到付款、销售订单、报销流程、入职流程、请假审批、登录认证、生产领料、退货退款。输出：SVG + 验收报告 + 可维护源码。
agent_created: true
---

# 流程图设计智能体（Flowchart Agent）

## 定位

**乙方产品团队 / 研发团队的流程图产能工具**：把"一句话需求"变成**符合标准符号、可验收、可维护**的专业流程图。零外部依赖（Node 22+ 即可跑），可在 WorkBuddy 对话中直接触发，也可命令行批量使用，脚本可移植到 openclaw / Claude Code。

## 核心原则（必须遵守）

1. **标准符号**：开始/结束=体育场形、处理=矩形、判断=菱形（必须带 ≥2 个带标签出口）、子流程=双矩形、数据=圆柱、备注=虚线框（ANSI/ISO）
2. **双语义配色**：形状表达类型、颜色表达角色/部门（泳道模式自动分配部门色板，起止绿+判断黄保留语义色）
3. **泳道可靠**：复杂泳道一律用**自研网格布局**（列=部门、子列=岗位、行=流程顺序），绝不依赖 ELK/Graphviz 自动布局（实测带回边流程必乱序/重叠）
4. **正逆向分离**：正向实线走右通道、逆向/异常虚线走左通道，互不重叠
5. **复杂度控制**：单图 ≤30 实体节点，超出自动拆图（主图折叠为 [[子流程]] + 子图 + 索引页）
6. **自动化验收**：每次交付跑 10 项检查（起止/判断分支/泳道不重叠/逆向虚线/标签/复杂度/配色/箭头/尺寸/结构），不过不放行
7. **密钥安全**：LLM 用环境变量 `LLM_API_KEY`（团队规范见 references/LLM_CONFIG.md），key 禁止写入代码库

## 工作流（一句话 → 交付，P0 交互增强）

```
输入：自然语言需求 / DSL 文本 / req.json
  ↓ ⓪ 补全引导  llm-model.analyzeNeed（严重缺角色/步骤 → 先反问用户补充，不硬画）
  ↓ ① 建模  llm-model.mjs（模板命中≤25字直出；LLM → DSL → 模板降级；selfCheck+autoFix+重试）
  ↓ ② 渲染  split-graph.mjs（≤30 直接渲染；>30 自动拆图；验收失败自动修复循环 ≤3 轮）
  ↓ ③ 验收  validate.mjs（10 项自动检查）
  ↓ ④ 交付  SVG + 验收报告 + 源码（req.json/mmd）
  ↓ ⑤ 迭代  agent-flow --edit [req.json] "修改描述"（自动接续最新一版，多轮对话式改图）
  ↓ ⑥ 预览  preview-server.mjs（在线预览 + 历史记录改一版 + PNG/PDF/Mermaid 导出）
```

**P0 交互原则**：需求不完整先引导补齐（不猜）；改图自动接续上一版（多轮）；验收失败自动修复循环（每轮输出修复说明）。

## 命令速查（在 scripts/ 目录执行）

```bash
# ★ 单命令智能体（最常用）：一句话 → 出图
node agent-flow.mjs "画一个采购到付款流程，涉及采购员、采购经理、供应商、仓库、质检、应付会计、出纳" --out 输出前缀

# ★ 对话式改图（多轮：不带文件名自动接续最新一版）
node agent-flow.mjs --edit "把驳回改成红色虚线"
node agent-flow.mjs --edit req.json "去掉确认订单，发货后加客户签收"

# 需求不完整时引导（exit 3，按提示补充角色/步骤后再试）
node agent-flow.mjs "画个流程"

# LLM 自由自然语言建模（配了 LLM_API_KEY 才走 LLM，否则降级）
node llm-model.mjs "自然语言需求" --out req.json

# 需求 DSL 建模（离线可靠，适合结构化描述）
node nlp-model.mjs 需求.txt req.json

# 知识库模板匹配（8 个模板：p2p/otc/入职/报销/请假/登录/领料/退货）
node template-finder.mjs "报销流程，出纳改叫资金专员" --out req.json

# 批量出图（N 个 req.json + 汇总报告）
node agent-batch.mjs req1.json req2.json ...   # 或 --dir <目录>

# 自动拆图（>30 节点 → 主图 + 子图 + 索引页）
node split-graph.mjs <req.json> <输出前缀> [--max 30]

# 在线预览（文件列表 + SVG 预览 + 验收报告 + PNG 导出）
node preview-server.mjs [port=8080] [dir]

# 验收（5 个自然语言用例全链路验证）
node verify-llm.mjs
```

## 输入协议（req.json）

```json
{
  "type": "flowchart",
  "title": "采购到付款 P2P",
  "lanes": [ { "dept": "采购部", "roles": ["采购员","采购经理"] } ],
  "nodes": [ { "id": "N1", "dept": "采购部", "role": "采购员", "action": "提交采购申请", "shape": "rect" } ],
  "edges": [ { "from": "N1", "to": "N2", "label": "申请", "reverse": false } ]
}
```
- `shape`：start | end | rect | diamond | data | subroutine
- `reverse: true` = 逆向/异常边（渲染为虚线，不走分层）

## DSL 输入格式（nlp-model）

```
标题: 采购审批流程
部门: 采购部 (采购员, 采购经理)
开始: 采购员.发起采购申请
判断: 采购经理.审批通过?
流程: 发起采购申请 → 审批通过? --通过--> 完成
流程: 审批通过? --驳回--> 发起采购申请 (逆向)
```

## 知识库模板（templates/，100 个流程，13 业务域）

| 域 | 模板数量 | 代表模板（触发词） |
|---|---|---|
| 供应链/采购 | 8 | p2p 采购到付款（采购/进货）、rfq 询价比价、payment-request 付款申请、return-refund 退货退款、supplier-onboard 供应商准入、supplier-eval 供应商评估、po-change 采购变更、goods-return 物料退货 |
| 销售/客服 | 10 | otc 销售订单（销售/订单）、quotation 报价、customer-onboard 客户建档、complaint 客诉、order-change 订单变更、price-approval 价格审批、collection 回款催收、online-service 在线咨询、ticket-escalation 工单升级、satisfaction-survey 满意度回访 |
| 仓储/物流 | 8 | stock-take 盘点、outbound 出库发货、warehouse-transfer 调拨、warehouse-inbound 入库验收、material-issue 领料、logistics-dispatch 物流调度、courier 快递、transport 干线运输 |
| 制造/质量 | 9 | workorder 工单、production-plan 生产计划、maintenance 设备维保、scrap 报废、quality-issue 质量 8D、schedule-change 排产变更、process-change 工艺变更、equipment-inspection 设备点检、safety-patrol 安全巡检 |
| 研发/运维 | 8 | bug-fix 缺陷修复、release 版本发布、change-request 变更管理、it-request IT 工单、requirement-mgmt 需求管理、tech-review 方案评审、code-review 代码走查、test-review 用例评审 |
| HR | 16 | onboarding 入职、resign 离职、transfer 调动、leave 请假、attendance 考勤、training 培训、probation 转正、salary-adjustment 调薪、social-security 社保公积金、recruit-request 招聘需求、interview 面试评估、overtime 加班、comp-time 调休、annual-leave 年假、resign-handover 离职交接、employee-care 员工关怀 |
| 财务/税务 | 12 | expense 报销、budget 预算、invoice 发票、asset 固定资产、month-end-close 月末结账、tax-filing 纳税申报、audit-support 内审、cash-plan 资金计划、budget-adjust 预算调整、travel-advance 差旅预支、bank-reconcile 银行对账、payroll 工资发放 |
| 行政/法务/安全 | 17 | office-supply 办公用品、vehicle-request 用车、visitor 访客、meeting-room 会议室、seal-request 用印、business-trip 出差、contract 合同、nda-request 保密协议、announcement 制度公告、data-export 数据导出、litigation 诉讼、legal-consult 法务咨询、ip-apply 知识产权、compliance-review 合规审查、archive-mgmt 档案、seal-borrow 印章借用、gift-purchase 礼品采购 |
| 其他 | 12 | login-auth 登录认证、project-kickoff 立项、invoice-auth 发票认证、tax-inspection 稽查配合、annual-settlement 汇算清缴、incident-report 事故报告、info-security 信息安全、emergency-response 应急响应、complaint-escalation 投诉升级、benefit-distribute 福利发放、newspaper-sub 报刊订阅、employee-care 员工关怀 |

> 任意需求先在模板库匹配（`template-finder`，开头关键词加权）；未命中再走 LLM/DSL。扩充模板用 `gen-100-templates.mjs`（DSL 批量定义）。

## 验收标准（10 项自动检查）

画布尺寸有效 / 节点 ≤30（子流程引用不计）/ 起止存在 / 判断带标签分支 ≥2 / 泳道不重叠 / 逆向全虚线 / 关键文本渲染 / 配色命中 / 箭头齐全 / SVG 闭合——全部通过才交付。

## LLM 接入（可选，团队规范）

- 环境变量：`LLM_API_KEY`（必填）、`LLM_BASE_URL`、`LLM_MODEL`（详见 references/LLM_CONFIG.md）
- 没配 key：自动降级到模板/DSL，不影响出图；配了 key：任意自然语言直接建模
- 安全：key 禁止写进代码库；`llm.config.json` 已被 .gitignore 忽略（仅本机兜底）

## 参考文档（references/）

- `flowchart-agent-spec.md`：完整开发规格（设计规范/渲染管线/工作流协议/验收标准/演进路线）
- `LLM_CONFIG.md`：团队环境变量配置指引（Win/macOS/Linux/CI + 验证 + 安全红线）
