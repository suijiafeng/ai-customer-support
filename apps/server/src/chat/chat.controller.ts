import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { normalizeAttachments, type ClientMeta } from '../common/normalize.js';
import { appConfig } from '../config.js';
import { AuthService } from '../auth/auth.service.js';
import { WidgetKeysService } from '../widget-keys/widget-keys.service.js';
import { ChatService } from './chat.service.js';
import { toVisitorChatResponse } from '../sessions/visitor-view.js';

const MAX_MESSAGE_LENGTH = 2000;

@SkipThrottle({ login: true })
@Controller('api/chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    private readonly widgetKeys: WidgetKeysService,
    private readonly auth: AuthService
  ) {}

  /**
   * 随对话响应下发访客令牌：会话就是在这一刻建立的，这里是唯一能自然签发的时机。
   * 每次都重新签发 = 顺带续期，活跃访客不会因为 TTL 到期丢掉自己的历史。
   */
  private withVisitorToken<T>(result: T): any {
    // handleChat 也可能返回 { error } 这种没有 sessionId 的形状（如租户校验失败），
    // 那种情况下不签发令牌——没有会话就没有要保护的东西
    const sessionId = (result as { sessionId?: unknown } | null)?.sessionId;
    // 访客侧响应只下发白名单字段（visitor-view.ts），客服内部判断不出现在公开接口里
    return typeof sessionId === 'string' && sessionId
      ? toVisitorChatResponse({ ...result, visitorToken: this.auth.issueVisitorToken(sessionId) })
      : result;
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post()
  async chatHandler(@Body() body: any, @Req() req: Request) {
    this.assertHasContent(body);
    this.assertValidSiteKey(body, req);
    // 同一会话串行处理；令牌校验也放进锁里，避免「第一条还在生成、会话看起来还没历史」
    // 的窗口期里，不带令牌的第二条请求混进来（A6）
    return this.chat.runExclusive(this.sessionIdOf(body), async () => {
      await this.assertMayWriteSession(body, req);
      await this.assertSessionTenant(body);
      try {
        return this.withVisitorToken(await this.chat.handleChat(body, undefined, this.clientMeta(req)));
      } catch (error: any) {
        this.logger.error(`[POST /api/chat] 处理失败: ${error?.stack || error}`);
        throw new InternalServerErrorException({
          error: 'chat workflow failed',
          detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
        });
      }
    });
  }

  private sessionIdOf(body: any): string {
    return String(body?.sessionId || 'default');
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post('agent-action')
  async agentAction(@Body() body: any, @Req() req: Request) {
    const sessionId = String(body?.sessionId || '');
    const actionId = String(body?.actionId || '');
    const decision = body?.decision === 'confirm' ? 'confirm' : body?.decision === 'cancel' ? 'cancel' : '';
    if (!sessionId || !actionId || !decision) {
      throw new BadRequestException({ error: 'sessionId, actionId and decision are required' });
    }
    this.assertValidSiteKey(body, req);
    const token = req.headers['x-visitor-token'] as string | undefined;
    if (!this.auth.verifyVisitorToken(token, sessionId)) {
      throw new ForbiddenException({ error: 'visitor_token_required' });
    }
    await this.assertSessionTenant(body);
    // 串行：同一条待确认操作连点两次「确认」时，第二次会看到已处理，不会执行两遍
    return this.chat.runExclusive(sessionId, async () => this.withVisitorToken(await this.chat.decideAgentAction({
      sessionId,
      actionId,
      decision,
      siteKey: body?.siteKey,
    })));
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ chat: { ttl: 60000, limit: 20 } })
  @Post('stream')
  async chatStream(@Body() body: any, @Res() res: Response, @Req() req: Request) {
    this.assertHasContent(body);
    this.assertValidSiteKey(body, req);
    return this.chat.runExclusive(this.sessionIdOf(body), () => this.streamLocked(body, res, req));
  }

  private async streamLocked(body: any, res: Response, req: Request) {
    // 在锁里校验：校验失败时还没写响应头，异常照常变成 JSON 错误响应
    await this.assertMayWriteSession(body, req);
    await this.assertSessionTenant(body);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 访客关掉页面 / 断网：立即取消上游模型请求，不再白白生成、计费。
    // 用 res 的 close 判断：响应还没正常结束就关闭，说明是客户端先断开。
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort(new Error('client disconnected'));
    });
    const emit = (event: string, data: unknown) => {
      if (abort.signal.aborted || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.chat.handleChat(
        body,
        (delta) => emit('delta', { text: delta }),
        this.clientMeta(req),
        abort.signal
      );
      emit('done', this.withVisitorToken(result));
    } catch (error: any) {
      this.logger.error(`[POST /api/chat/stream] 处理失败: ${error?.stack || error}`);
      emit('error', {
        error: 'chat workflow failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
      });
    } finally {
      res.end();
    }
  }

  /**
   * 访客 IP：只信 Express 按 TRUST_PROXY 解析出来的 req.ip。
   * 之前无条件读 x-forwarded-for / x-real-ip，任何访客都能伪造工作台里显示的来源 IP；
   * 未配置 TRUST_PROXY 时这些头来自客户端本身，不可信。
   */
  private clientMeta(req: Request): ClientMeta {
    let ipRaw = String(req.ip || '');
    if (appConfig.trustProxy && !ipRaw) {
      ipRaw = String(req.headers['x-real-ip'] || '').trim();
    }
    const ip = ipRaw.startsWith('::ffff:') ? ipRaw.slice(7) : ipRaw;
    return { ip: ip || null, userAgent: req.headers['user-agent'] ?? null };
  }

  /**
   * 已有对话的会话再写入时必须出示该会话的访客令牌。
   * sessionId 由浏览器生成且会出现在 URL/日志里，siteKey 又是页面源码里的公开值：
   * 不校验的话，知道 sessionId 的任何人都能往别人的会话里插话，并借 clientMessageId
   * 去重分支拿到整段历史。首条消息（会话尚不存在）无需令牌——令牌正是在那次响应里签发的。
   * ALLOW_ANON_SESSION_READ=true 为存量 widget 灰度开关，与会话读取共用。
   */
  private async assertMayWriteSession(body: any, req: Request) {
    const sessionId = String(body?.sessionId || 'default');
    if (!(await this.chat.sessionHasHistory(sessionId))) return;
    const token = req.headers['x-visitor-token'] as string | undefined;
    if (this.auth.verifyVisitorToken(token, sessionId)) return;
    if (process.env.ALLOW_ANON_SESSION_READ === 'true') return;
    throw new ForbiddenException({
      error: 'visitor_token_required',
      detail: '向已有会话发送消息需要出示该会话的访客令牌（x-visitor-token 头）',
    });
  }

  /**
   * 会话在第一条消息时绑定到当时的租户（session.tenantKey），之后只能用同一租户的 siteKey 续写。
   * 否则拿着自己的访客令牌、换成另一个租户的公开 siteKey 发消息，就能把会话改挂到别的租户下，
   * 绕开原租户的停用状态和工具开关。存量会话没有 tenantKey 的，放行并在本次写入时绑定。
   */
  private async assertSessionTenant(body: any) {
    const sessionId = String(body?.sessionId || '');
    if (!sessionId) return;
    const { session } = await this.chat.loadSession(sessionId);
    const supplied = String(body?.siteKey || '').trim();
    if (session?.tenantKey && session.tenantKey !== supplied) {
      throw new ForbiddenException({
        error: 'session_tenant_mismatch',
        detail: '该会话属于另一个租户，不能用当前 siteKey 续写',
      });
    }
  }

  private assertHasContent(body: any) {
    const message = String(body?.message || '').trim();
    // 按服务端真正会保存的附件计数，避免 [{}] 这类空壳附件绕过「必须有内容」的校验
    const attachments = normalizeAttachments(body?.attachments);
    if (!message && attachments.length === 0) {
      throw new BadRequestException({ error: 'message or attachments required' });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException({ error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    }
  }

  private assertValidSiteKey(body: any, req: Request) {
    const source = (req.headers.origin as string) || (req.headers.referer as string) || '';
    let originHost: string | null = null;
    try {
      originHost = source ? new URL(source).hostname.toLowerCase() : null;
    } catch {
      originHost = null;
    }
    const verdict = this.widgetKeys.verify(body?.siteKey, body?.tenantId, originHost);
    if (verdict !== 'ok') {
      throw new ForbiddenException({ error: verdict });
    }
  }
}
