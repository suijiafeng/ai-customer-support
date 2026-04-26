var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
/**
 * chat 专用限流守卫：把 throttler 的毫秒剩余时间转换为标准秒级 `Retry-After`，
 * 并在响应体里返回 retryAfter，便于前端展示倒计时。
 */
let ChatThrottleGuard = class ChatThrottleGuard extends ThrottlerGuard {
    /**
     * chat 限流追踪键：IP + 会话标识（sessionId 或 visitor.code）。
     * 避免同一出口 IP 下不同访客互相占用桶，和前端“按当前会话发送频率”更一致。
     */
    async getTracker(req) {
        const ip = String(req?.ip || req?.ips?.[0] || 'unknown');
        const sessionId = String(req?.body?.sessionId || '').trim();
        const visitorCode = String(req?.body?.visitor?.code || '').trim();
        const scope = (sessionId || visitorCode).slice(0, 64);
        return scope ? `${ip}:${scope}` : ip;
    }
    async throwThrottlingException(context, detail) {
        const { res } = this.getRequestResponse(context);
        const ms = Number(detail?.timeToBlockExpire ?? detail?.timeToExpire ?? 0);
        const retryAfter = Math.max(1, Math.ceil(ms / 1000));
        res.header('Retry-After', String(retryAfter));
        throw new HttpException({
            error: 'rate limit exceeded',
            retryAfter,
        }, HttpStatus.TOO_MANY_REQUESTS);
    }
};
ChatThrottleGuard = __decorate([
    Injectable()
], ChatThrottleGuard);
export { ChatThrottleGuard };
//# sourceMappingURL=chat-throttle.guard.js.map