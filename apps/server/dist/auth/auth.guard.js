var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
let AgentAuthGuard = class AgentAuthGuard {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const header = String(req.headers.authorization || '');
        const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
        let agent = bearer ? this.auth.verify(bearer) : null;
        if (!agent) {
            const ticket = String(req.query?.ticket || '');
            if (ticket)
                agent = this.auth.verifySseTicket(ticket);
        }
        if (!agent) {
            throw new UnauthorizedException({ error: 'agent authentication required' });
        }
        req.agent = agent;
        return true;
    }
};
AgentAuthGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [AuthService])
], AgentAuthGuard);
export { AgentAuthGuard };
//# sourceMappingURL=auth.guard.js.map