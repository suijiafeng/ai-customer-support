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

## 部署

仓库里没有写公开的在线地址。三种走法都在代码里：

1. 根目录 `Dockerfile` 同时装入 API、演示站、挂件和工作台。SQLite 写在 `/data`。
2. `docker-compose.yml` 起 Postgres 和拆开的 API、工作台、挂件、演示站。
3. `render.yaml` 用 Docker，`healthCheckPath` 为 `/api/health`。Free 实例磁盘不持久，要留数据就填 `DATABASE_URL`，或挂磁盘到 `/data`。

多实例必须设置同一个 `AUTH_SECRET`。

## 已知限制

- FAQ 是关键词和 bigram，不是语义检索。
- 热数据集在内存里。多实例不会互相广播 SSE。
- 每日趋势大约 30 分钟写一次。`DB_DRIVER=memory` 时重启即清空。
- 访客挂件的图片发送是关的。工作台仍可发送 data URL 图片，每张不超过 2MB，最多 4 张。
- `docs/ARCHITECTURE.md` 写的是更早的 Socket.IO / Prisma 方案，文件开头已标明过时。`docs/FEATURE-IDEAS.md` 不是已排期的功能。
