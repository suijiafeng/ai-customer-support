var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from '@nestjs/common';
import { map } from 'rxjs';
let ResponseInterceptor = class ResponseInterceptor {
    intercept(context, next) {
        // SSE 长连接由 NestJS SseHandler 直接写流，跳过包装。
        // 注意：@Sse 路由的响应头在拦截器执行前就已写出（Nest 先 writeHead 再订阅），
        // 这里不能 setHeader（会抛 Cannot set headers after they are sent 并打断整条流），
        // 反缓冲头改由 main.ts 的前置中间件设置。
        const req = context.switchToHttp().getRequest();
        if (req.headers?.accept?.includes('text/event-stream')) {
            return next.handle();
        }
        return next.handle().pipe(map((data) => ({ code: 0, msg: 'ok', data: data ?? null })));
    }
};
ResponseInterceptor = __decorate([
    Injectable()
], ResponseInterceptor);
export { ResponseInterceptor };
//# sourceMappingURL=response.interceptor.js.map