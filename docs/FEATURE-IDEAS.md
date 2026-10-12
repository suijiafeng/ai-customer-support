# 可借鉴的开源项目功能（2026-10 调研）

对照 Chatwoot、Tiledesk、Papercups、Chaskiq、ChatterMate、SiteChat 等开源客服/AI 支持项目，
筛出与 AssistFlow「个人主页 AI 助手 + 少量人工客服」定位匹配、且现有架构（内存 + 写穿透、SSE、规则引擎）能低成本落地的功能。
按「投入 / 价值」排序，前三项建议先做。

## 一、优先级高（小改动、直接提升接待体验）

| 功能 | 参考 | 现状缺口 | 落地思路 |
|------|------|----------|----------|
| **输入中提示（typing indicator）** | Papercups、Tiledesk | 访客只能看到「正在同步」，客服打字时访客无感知；客服也看不到访客在输入 | 新增 `POST /api/sessions/:id/typing`（客服）与 `/api/chat/typing`（访客，带访客令牌），通过现有 `SseService.notifySession` 推 `typing` 事件，前端 3s 无新事件自动消失。不落库 |
| **快捷回复按 `/` 唤起** | Chatwoot canned responses | 工作台已有 20 条常用语，但要点菜单选 | Composer 里输入 `/` 弹出可搜索列表，Enter 插入；常用语增加 `shortcode` 字段 |
| **会话标签 / 备注** | Chatwoot labels、private notes | 工单有备注，会话本身没有 | `Session` 加 `tags: string[]`、`notes`；队列支持按标签筛选；AI 诊断面板已有意图，可自动打 `pricing / hiring` 标签 |
| **营业时间 + 离线留言** | Chatwoot business hours | 客服不在时访客只能被 AI 兜底，没有「留下联系方式」的结构化入口 | 配置 `BUSINESS_HOURS`；非营业时段「转人工」改为弹出联系方式表单（复用 `profile` 接口），工单标记 `offline_lead` |
| **CSAT 满意度评价** | Chatwoot CSAT | 会话关闭后无反馈 | 会话 `closed` 时向访客推一条 `system` 消息带 1-5 星按钮；新增 `POST /api/sessions/:id/csat`（访客令牌）；指标面板加平均分与差评列表 |

## 二、优先级中（提升 AI 回答质量与运营闭环）

| 功能 | 参考 | 落地思路 |
|------|------|----------|
| **知识库 RAG（网页/文档抓取）** | ChatterMate、SiteChat、Tiledesk | 现在只有手写 `faqs.json` + bigram 检索。可加「URL / Markdown 导入 → 分段 → embedding」管线，用 SQLite 存向量（或 `pgvector`），检索结果作为 `sources` 带引用返回；小规模先用 OpenAI 兼容的 `/embeddings` 接口 |
| **未命中问题一键转 FAQ** | Chatwoot help center、本仓库已有 `kb:drafts` 脚本 | 把 `scripts/miss-to-faq.js` 的能力搬到工作台「数据管理 → 知识库」页：列出高频未命中问句，客服填答案直接写入 `faqs.json`（已有热更新） |
| **自动分配 / 轮询派单** | Chatwoot round-robin + agent capacity | 当前是抢单。加 `ASSIGN_STRATEGY=round_robin`，客服有「在线/忙碌」状态（`POST /api/auth/presence`），`waiting_human` 会话按在线客服轮询分配，超过 N 分钟无人接再回到大厅 |
| **会话转交** | Chatwoot assign to agent | 普通客服只能自己处理或等管理员；加 `POST /api/sessions/:id/transfer { toAgentId }`，被转交方收到队列 SSE 高亮 |
| **预聊表单（pre-chat form）** | Chatwoot pre-chat form | 租户可配置「首次对话前要不要先填称呼/联系方式」；widget 读 `data-prechat="true"`，服务端把结果写入 `profile` |

## 三、优先级低（锦上添花或需要新基础设施）

- **邮件转发对话记录 / 离线邮件通知**（Papercups、Chaskiq）：可在工单创建、会话关闭时发邮件；需要 SMTP 配置。
- **多渠道接入**（Chatwoot：WhatsApp、Telegram、邮件）：对个人主页场景价值有限，暂不建议。
- **AI 对话摘要**：会话关闭或转人工时让模型生成三句摘要写入 `session.reason`，客服接手不用翻全部历史。现有 `AiService.buildReply` 结构可直接复用。
- **访客在线状态 / 已读回执**：需要 widget 定时心跳，与 SSE 现有心跳合并即可，但价值一般。
- **工作台键盘快捷键**（Chatwoot）：`j/k` 切换会话、`cmd+enter` 发送、`e` 标记解决。

## 参考来源

- Chatwoot 功能页：https://www.chatwoot.com/features
- Chatwoot 支持台用例（CSAT、自动分配、宏）：https://www.chatwoot.com/use-cases/support-desk
- ChatterMate（Apache-2.0，RAG + 人工接管 + 工作流）：https://sourceforge.net/software/product/ChatterMate/
- SiteChat（MIT，网页抓取 + 人工接管队列）：https://sitechatai.duckdns.org/
- Papercups（维护模式，输入提示、Slack 同步）：https://best-of-web.builder.io/library/papercups-io/papercups
- Tiledesk（RAG + 人工在环、输入提示、送达回执）：https://developers.italia.it/it/software/github.com/tiledesk/tiledesk.html
- 自托管选型对比（Chatwoot / Papercups / Tiledesk）：https://www.pistack.xyz/posts/self-hosted-live-chat-chatwoot-papercups-tiledesk-guide/
