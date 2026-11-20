# 配置、部署与客服 Agent

给要改代码或自己部署的人。产品介绍在仓库根目录的 README。

## 演示账号

种子在 `apps/server/data/agents.json`。三个工号的口令都是 `123456`，`9527` 是管理员，`9528` 和 `9529` 是客服。

`NODE_ENV=production`（Docker、Render、`npm run start`）拒绝这个口令，除非设置 `ALLOW_DEMO_CREDENTIALS=true`（也接受 `1` / `yes` / `on`）。`npm run start -- demo` 会自动打开这个开关。改完密码后关掉变量并重启。已经发出的 JWT 不会因为改密码提前失效；要立刻切断访问，停用或删除账号。直接改 `agents.json` 不会热加载。

## 本地开发

`npm run start -- dev` 会热更新工作台（http://localhost:5174/），并把 `NODE_ENV=development` 传给预构建。这样产出的挂件在 http://localhost:3001/ 上会抛 `jsxDEV is not a function`。要在 3001 看嵌入对话，开发服务起来之后另开终端：

```bash
NODE_ENV=production npm run build --workspace assistflow-widget
NODE_ENV=production npm run build --workspace assistflow-demo
```

http://localhost:5173/ 是挂件源码预览，页面上没有种子租户的 `data-key` / `data-name`，不能直接拿来对话。

```bash
npm test
npm run build
npm run smoke          # 需要服务已在运行，默认 http://localhost:3001
node scripts/dialog-test.js
```

## 环境变量

不创建 env 文件也能启动。缺省值在 `apps/server/src/config.ts`。加载顺序：进程环境变量 > `.env.local` > `.env`。

布尔开关空值用默认；`1` / `true` / `yes` / `on` 为开，其余为关。

| 变量 | 默认 | 含义 |
|---|---|---|
| `PORT` | `3001` | 监听端口 |
| `NODE_ENV` | 空 | `production` 时收紧错误详情，并拒绝演示口令 |
| `ALLOW_DEMO_CREDENTIALS` | 生产关闭 | 生产环境允许 `123456` 登录 |
| `AUTH_SECRET` | 自动生成 | JWT、SSE 票据、访客令牌的 HMAC 密钥。多实例必须相同 |
| `AI_ENABLED` | `false` | 关闭或没有 Key 时只用本地 FAQ |
| `AI_PROVIDER` | 按地址推断，否则 `openai` | 厂商预设 |
| `AI_API_KEY` | 空 | 也认 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`。`<PROVIDER>_API_KEY` 优先 |
| `AI_BASE_URL` / `AI_MODEL` | 预设 | 地址不是任何预设时按 `custom` 处理，直接用这个地址和 `AI_MODEL` |
| `HANDOFF_IDLE_RELEASE_MINUTES` | `10` | 人工静默多久交还 AI。`0` 为永不交还 |
| `DB_DRIVER` | 有 `DATABASE_URL` 则 postgres，否则 sqlite | `sqlite` / `postgres` / `memory` |
| `DATABASE_URL` | 空 | Postgres 连接串 |
| `SQLITE_PATH` | `DATA_DIR/assistflow.db` | Docker 镜像里是 `/data/assistflow.db` |
| `DATA_DIR` | `apps/server/data` | FAQ、账号、话术 |
| `TRUST_PROXY` | 不信任转发头 | `render.yaml` 设为 `1` |
| `CORS_ORIGINS` | 空（允许任意来源） | 逗号分隔。设置后允许 `Authorization`、`Content-Type`、`x-visitor-token` |
| `DEMO_ENABLED` / `WIDGET_ENABLED` / `WORKSTATION_ENABLED` | 开 | 是否托管演示站、`/widget/widget.js`、`/workstation/` |

厂商预设和「自定义地址必须自带 Key」的规则在 `apps/server/src/config.ts` 与模型管理里。服务器不会把环境变量中的 Key 发到管理员填写的任意地址。

## 客服 Agent

办事类的话进入 `apps/server/src/agent/loop.ts`。没配 Key 或关掉 AI 时，用 `planner.ts` 的本地规则选工具，不发起付费请求。

工具：`query_order`、`query_logistics`、`create_ticket`、`change_address`、`request_refund`、`transfer_human`。订单和物流的默认实现是 `DemoCommerce`，回复会标明演示数据。`change_address` 和 `request_refund` 先在挂件里出确认卡片，访客点确认才执行。调用写进 `agent_audit`，客服可看 `GET /api/sessions/:id/agent-audit`。

### 消息路由

访客的一条消息在 `apps/server/src/chat/chat.service.ts` 里按下面的顺序处理，前一步接手了就不再往下走：

1. **重复消息**：同一个 `clientMessageId` 已处理过，直接返回已有结果。
2. **人工接管中**：AI 让位，只记录消息；访客主动切回 AI 或客服超时未回时交还 AI。
3. **寒暄**：命中 `small-talk.json` 的内置回复。
4. **明确要人工**（转人工 / 找人工 / 真人沟通…）：规则直接建跟进事项、进入接待大厅，**不经过 Agent**。
5. **客服 Agent**：只有模型（或本地规则）真的调用了工具，才算 Agent 接手。模型只回了文字，或者第一步就超时、报错，都交回第 6 步。
6. **普通回复**：FAQ 检索 → `ai-persona.txt` 人设 + 最近对话 → 模型流式回答；模型不可用时用 FAQ 答案或兜底话术。转人工规则在这一步也会再判断一次。

这样设计的原因：Agent 是「办事路由」，不负责一般问答。让它的纯文字回复直接发给访客，会绕开知识库、人设、流式输出和转人工规则。代价是开着 AI 时，非办事类的消息会多一次不带流式的模型调用（Agent 判断要不要调工具）。

## 部署

仓库里没有写公开的在线地址。三种走法都在代码里：

1. 根目录 `Dockerfile` 同时装入 API、演示站、挂件和工作台。SQLite 写在 `/data`。
2. `docker-compose.yml` 起 Postgres 和拆开的 API、工作台、挂件、演示站。
3. `render.yaml` 用 Docker，`healthCheckPath` 为 `/api/health`。Free 实例磁盘不持久，要留数据就填 `DATABASE_URL`，或挂磁盘到 `/data`。

多实例必须设置同一个 `AUTH_SECRET`。

## 权限与安全

客服身份、会话归属和租户都以服务端「当前」状态为准，不只在登录或建连时检查一次。

- **令牌**：登录 JWT 和 60 秒的 SSE 票据都带账号的 `tokenVersion`（`tv`）。改密码时版本号加 1，旧令牌、旧票据立刻作废。停用、删除的账号每次请求都会被拒。管理员改自己的密码时，响应里带一枚新令牌，工作台换上后不会掉线。
- **身份同步**：`GET /api/auth/me` 返回账号当前的角色。工作台在加载、窗口重新聚焦、遇到 403、SSE 推来 `role` / `revoked` 时都会调一次。降级后管理菜单立刻消失，令牌失效就回到登录页。
- **SSE 复核**（`SseService.live`）：客服的队列和会话长连接在每条推送（含心跳）前，以及账号被修改的当下，都按当前账号重新核对。
  - 账号停用、删除或改了密码：推一条 `revoked {reason:'account_changed'}`，然后服务端断开。
  - 角色变化：推 `role {role}`，再按新权限补发一次队列快照。降级后就收不到别人名下的会话了。
  - 会话被别的客服认领、当前客服已无权查看：推 `revoked {reason:'session_reassigned'}` 后断开，认领那条回复也不会推给他。
- **SSE 的 HTTP 状态码**：单会话 `GET` 和 SSE 的准入放在 `SessionAccessGuard` 里，守卫在写响应头之前执行。客服凭证失效返回 401，无权查看或访客令牌不对返回 403，不再出现「200 + `event: error`」让 EventSource 无限重连。
- **租户绑定**：会话在第一条消息时绑定租户（`session.tenantKey`），之后不会被消息改写。用别的租户的 `siteKey` 调 `/api/chat`、`/api/chat/stream`、`/api/chat/agent-action` 一律返回 `403 session_tenant_mismatch`。会话读取时如果显式带了 `x-site-key` 头或 `?siteKey=`，也要和会话所属租户一致。模型和工具开关都按会话自己的租户来判断。
- **访客视图白名单**（`sessions/visitor-view.ts`）：访客读会话（GET / SSE）和对话接口返回的 `session` / `messages` 只带挂件需要的字段：状态、排队、客服显示名，以及消息的内容、附件、时间和确认卡片。情绪、优先级、意图、客服 id、完整跟进事项、模型厂商与型号、检索分数、工具调用轨迹都不下发。对话响应的 `ticket` 只保留 `id` 和 `status`，`ai` 只保留 `used` 和 `fallback`，`sources` 去掉 `score`。
- **消息署名**：客服消息记录发送者的 `agentRole`。工作台里只有自己发的消息显示「本」，管理员插话显示「管理员 · 客服9527」。
- **「急」**：`session.priority` 和工作台的「急」用同一条规则（`@assistflow/shared` 的 `isUrgentSession`）：有关联跟进事项就看它的优先级，没有就看访客原话是否明确催促。普通转人工不再一律算高优先级。

## 已知限制

- FAQ 是关键词和 bigram，不是语义检索。
- 热数据集在内存里。多实例不会互相广播 SSE。账号变更通知（`AuthService.changes$`）同样只在单个进程内有效：多实例时，别的实例上的长连接要等到下一条推送或下一次心跳（最长 30 秒）才会被复核断开。
- 普通客服能看到所有租户的会话，这是当前的产品设定，尚未按租户隔离客服。
- 访客令牌（7 天）无法单独吊销。它只能读写自己那一个会话，租户被停用后也不能再发消息。
- 角色变化靠 SSE `role` 事件、窗口聚焦和 403 触发同步。SSE 断开又没有其他操作时，菜单要到下次聚焦才会更新，不过服务端接口本身始终按当前角色鉴权。
- 同一会话的消息按顺序串行处理（`common/keyed-lock.ts`），锁只在单个进程内有效，多实例需要换成 Redis 之类的分布式锁。
- 每日趋势大约 30 分钟写一次。`DB_DRIVER=memory` 时重启即清空。
- 访客挂件的图片发送是关的。工作台仍可发送 data URL 图片，每张不超过 2MB，最多 4 张。
- `docs/ARCHITECTURE.md` 写的是更早的 Socket.IO / Prisma 方案，文件开头已标明过时。`docs/FEATURE-IDEAS.md` 不是已排期的功能。
