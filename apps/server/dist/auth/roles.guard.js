var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { ForbiddenException, Injectable } from '@nestjs/common';
/** 假定 AgentAuthGuard 已经跑过、req.agent 已存在，需搭配使用：@UseGuards(AgentAuthGuard, XxxGuard) */
function agentFrom(context) {
    return context.switchToHttp().getRequest().agent;
}
/** 系统级模块（租户/模型/账号管理）：仅系统管理员可访问。 */
let SuperAdminGuard = class SuperAdminGuard {
    canActivate(context) {
        if (agentFrom(context).role !== 'superadmin') {
            throw new ForbiddenException({ error: 'superadmin only' });
        }
        return true;
    }
};
SuperAdminGuard = __decorate([
    Injectable()
], SuperAdminGuard);
export { SuperAdminGuard };
/** 客服数据接口（会话/工单/统计）：系统管理员不涉及客服数据，一律拒绝。 */
let CustomerServiceGuard = class CustomerServiceGuard {
    canActivate(context) {
        if (agentFrom(context).role === 'superadmin') {
            throw new ForbiddenException({ error: 'not available to superadmin' });
        }
        return true;
    }
};
CustomerServiceGuard = __decorate([
    Injectable()
], CustomerServiceGuard);
export { CustomerServiceGuard };
/** 账号管理入口：admin（管下属普通客服）与 superadmin（管客服+管理员）可进；普通客服拒绝。
 *  具体"只能操作下级账号"的层级校验在 AuthService 里按目标账号逐一执行。 */
let AccountManagerGuard = class AccountManagerGuard {
    canActivate(context) {
        if (agentFrom(context).role === 'agent') {
            throw new ForbiddenException({ error: 'manager only' });
        }
        return true;
    }
};
AccountManagerGuard = __decorate([
    Injectable()
], AccountManagerGuard);
export { AccountManagerGuard };
//# sourceMappingURL=roles.guard.js.map