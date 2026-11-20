import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AuthenticatedAgent } from '../auth/auth.service.js';
import { SessionsService } from './sessions.service.js';

export interface SessionAccess {
  /** 客服身份；访客访问时为 null */
  agent: AuthenticatedAgent | null;
}

/**
 * 单会话读取（GET 与 SSE）的准入判定，必须是「本会话的访客」或「有权查看的客服」。
 *
 * 放在守卫里而不是处理函数里：@Sse 处理函数里抛的异常，Nest 已经先写了 200 和
 * text/event-stream 头，只能补一条 `event: error`，EventSource 会把它当成断线一直重连。
 * 守卫在写响应头之前执行，401/403 能原样返回，浏览器看到非 200 就不再重连。
 *
 * - 带了客服凭证（Bearer / ?ticket=）但已失效：401，客户端应重新登录或换票；
 * - 客服无权查看（会话归别人）：403；
 * - 访客令牌：REST 走 `x-visitor-token` 头，SSE 走 `?vt=`；缺失或不匹配 403；
 * - 显式带了 siteKey（`x-site-key` 头或 `?siteKey=`）但不是该会话所属租户：403。
 *
 * 顺序：先鉴权再查库，避免把「会话是否存在」泄漏给未授权方。
 * ALLOW_ANON_SESSION_READ=true 仅供存量 widget 灰度期使用，默认关闭。
 */
@Injectable()
export class SessionAccessGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { sessionAccess?: SessionAccess }>();
    const sessionId = String((req.params as any)?.sessionId || '');
    const header = String(req.headers.authorization || '');
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    const ticket = String((req.query as any)?.ticket || '');

    if (bearer || ticket) {
      const agent = bearer ? this.auth.verify(bearer) : this.auth.verifySseTicket(ticket);
      if (!agent) throw new UnauthorizedException({ error: 'agent authentication required' });
      const { session } = await this.sessions.loadDetail(sessionId);
      if (session && !this.sessions.canView(session, agent)) {
        throw new ForbiddenException({ error: 'session is handled by another agent' });
      }
      req.sessionAccess = { agent };
      return true;
    }

    const token =
      (req.headers['x-visitor-token'] as string | undefined) || ((req.query as any)?.vt as string | undefined);
    const visitorOk = this.auth.verifyVisitorToken(token, sessionId);
    if (!visitorOk && process.env.ALLOW_ANON_SESSION_READ !== 'true') {
      throw new ForbiddenException({
        error: 'visitor token required',
        detail: '会话读取需要出示该会话的访客令牌（x-visitor-token 头或 ?vt= 查询串）',
      });
    }
    const siteKey = String((req.headers['x-site-key'] as string) || (req.query as any)?.siteKey || '').trim();
    if (siteKey) {
      const { session } = await this.sessions.loadDetail(sessionId);
      if (session?.tenantKey && session.tenantKey !== siteKey) {
        throw new ForbiddenException({ error: 'session_tenant_mismatch' });
      }
    }
    req.sessionAccess = { agent: null };
    return true;
  }
}
