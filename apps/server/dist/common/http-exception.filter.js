var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var HttpExceptionFilter_1;
import { Catch, HttpException, HttpStatus, Logger, } from '@nestjs/common';
let HttpExceptionFilter = HttpExceptionFilter_1 = class HttpExceptionFilter {
    logger = new Logger(HttpExceptionFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const res = ctx.getResponse();
        if (res.headersSent)
            return;
        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();
            let msg;
            let data = null;
            if (typeof body === 'string') {
                msg = body;
            }
            else if (typeof body === 'object' && body !== null) {
                const b = body;
                msg = String(b.error ?? b.message ?? exception.message);
                const extra = Object.fromEntries(Object.entries(b).filter(([k]) => !['error', 'message', 'statusCode'].includes(k)));
                if (Object.keys(extra).length)
                    data = extra;
            }
            else {
                msg = exception.message;
            }
            return res.status(status).json({ code: status, msg, data });
        }
        this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            code: 500,
            msg: 'internal server error',
            data: null,
        });
    }
};
HttpExceptionFilter = HttpExceptionFilter_1 = __decorate([
    Catch()
], HttpExceptionFilter);
export { HttpExceptionFilter };
//# sourceMappingURL=http-exception.filter.js.map