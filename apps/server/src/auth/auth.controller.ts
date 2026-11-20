import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AgentAuthGuard } from './auth.guard.js';
import { AuthService, type AuthenticatedAgent } from './auth.service.js';

@SkipThrottle({ chat: true })
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ login: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() body: any) {
    const result = this.auth.login(body?.agentNo, body?.password);
    if (!result) {
      throw new UnauthorizedException({ error: 'invalid agent number or password' });
    }
    return result;
  }

  @UseGuards(AgentAuthGuard)
  @Post('sse-ticket')
  sseTicket(@Req() req: any) {
    const ticket = this.auth.issueSseTicket(req.agent as AuthenticatedAgent);
    if (!ticket) throw new UnauthorizedException({ error: 'agent authentication required' });
    return { ticket };
  }

  /**
   * 当前登录身份（以账号当前值为准）。工作台在加载、窗口重新聚焦、遇到 403、
   * 以及 SSE 推来 role 事件时调用，用来同步被管理员改过的角色。
   */
  @UseGuards(AgentAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    const { id, name, role } = req.agent as AuthenticatedAgent;
    return { agent: { id, name, role } };
  }
}
