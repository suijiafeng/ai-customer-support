var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ChatController_1;
import { BadRequestException, Body, Controller, ForbiddenException, InternalServerErrorException, Logger, Post, Req, Res, UseGuards, } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { normalizeAttachments } from '../common/normalize.js';
import { appConfig } from '../config.js';
import { AuthService } from '../auth/auth.service.js';
import { WidgetKeysService } from '../widget-keys/widget-keys.service.js';
import { ChatService } from './chat.service.js';
const MAX_MESSAGE_LENGTH = 2000;
let ChatController = ChatController_1 = class ChatController {
    chat;
    widgetKeys;
    auth;
    logger = new Logger(ChatController_1.name);
    constructor(chat, widgetKeys, auth) {
        this.chat = chat;
        this.widgetKeys = widgetKeys;
        this.auth = auth;
    }
    /**
     * 随对话响应下发访客令牌：会话就是在这一刻建立的，这里是唯一能自然签发的时机。
     * 每次都重新签发 = 顺带续期，活跃访客不会因为 TTL 到期丢掉自己的历史。
     */
    withVisitorToken(result) {
        // handleChat 也可能返回 { error } 这种没有 sessionId 的形状（如租户校验失败），
        // 那种情况下不签发令牌——没有会话就没有要保护的东西
        const sessionId = result?.sessionId;
        return typeof sessionId === 'string' && sessionId
            ? { ...result, visitorToken: this.auth.issueVisitorToken(sessionId) }
            : result;
    }
    async chatHandler(body, req) {
        this.assertHasContent(body);
        this.assertValidSiteKey(body, req);
        await this.assertMayWriteSession(body, req);
        try {
            return this.withVisitorToken(await this.chat.handleChat(body, undefined, this.clientMeta(req)));
        }
        catch (error) {
            this.logger.error(`[POST /api/chat] 处理失败: ${error?.stack || error}`);
            throw new InternalServerErrorException({
                error: 'chat workflow failed',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
            });
        }
    }
    async chatStream(body, res, req) {
        this.assertHasContent(body);
        this.assertValidSiteKey(body, req);
        await this.assertMayWriteSession(body, req);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        const emit = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
            const result = await this.chat.handleChat(body, (delta) => emit('delta', { text: delta }), this.clientMeta(req));
            emit('done', this.withVisitorToken(result));
        }
        catch (error) {
            this.logger.error(`[POST /api/chat/stream] 处理失败: ${error?.stack || error}`);
            emit('error', {
                error: 'chat workflow failed',
                detail: process.env.NODE_ENV === 'production' ? undefined : String(error?.message || error),
            });
        }
        finally {
            res.end();
        }
    }
    /**
     * 访客 IP：只信 Express 按 TRUST_PROXY 解析出来的 req.ip。
     * 之前无条件读 x-forwarded-for / x-real-ip，任何访客都能伪造工作台里显示的来源 IP；
     * 未配置 TRUST_PROXY 时这些头来自客户端本身，不可信。
     */
    clientMeta(req) {
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
    async assertMayWriteSession(body, req) {
        const sessionId = String(body?.sessionId || 'default');
        if (!(await this.chat.sessionHasHistory(sessionId)))
            return;
        const token = req.headers['x-visitor-token'];
        if (this.auth.verifyVisitorToken(token, sessionId))
            return;
        if (process.env.ALLOW_ANON_SESSION_READ === 'true')
            return;
        throw new ForbiddenException({
            error: 'visitor_token_required',
            detail: '向已有会话发送消息需要出示该会话的访客令牌（x-visitor-token 头）',
        });
    }
    assertHasContent(body) {
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
    assertValidSiteKey(body, req) {
        const source = req.headers.origin || req.headers.referer || '';
        let originHost = null;
        try {
            originHost = source ? new URL(source).hostname.toLowerCase() : null;
        }
        catch {
            originHost = null;
        }
        const verdict = this.widgetKeys.verify(body?.siteKey, body?.tenantId, originHost);
        if (verdict !== 'ok') {
            throw new ForbiddenException({ error: verdict });
        }
    }
};
__decorate([
    UseGuards(ThrottlerGuard),
    Throttle({ chat: { ttl: 60000, limit: 20 } }),
    Post(),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "chatHandler", null);
__decorate([
    UseGuards(ThrottlerGuard),
    Throttle({ chat: { ttl: 60000, limit: 20 } }),
    Post('stream'),
    __param(0, Body()),
    __param(1, Res()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "chatStream", null);
ChatController = ChatController_1 = __decorate([
    SkipThrottle({ login: true }),
    Controller('api/chat'),
    __metadata("design:paramtypes", [ChatService,
        WidgetKeysService,
        AuthService])
], ChatController);
export { ChatController };
//# sourceMappingURL=chat.controller.js.map