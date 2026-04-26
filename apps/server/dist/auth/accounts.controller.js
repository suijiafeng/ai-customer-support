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
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from './auth.guard.js';
import { AccountManagerGuard } from './roles.guard.js';
import { AuthService } from './auth.service.js';
/**
 * 账号管理：层级化管理。
 * - admin（管理员客服）：只能管理普通客服（agent）账号
 * - superadmin（系统管理员）：能管理普通客服与管理员客服账号
 * 所有操作都要求目标账号严格低于操作者级别（同级与自己不可操作），层级校验在 AuthService 里。
 */
let AccountsController = class AccountsController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    list(req) {
        return { accounts: this.auth.list(req.agent) };
    }
    create(body, req) {
        const operator = req.agent;
        return { account: this.auth.create(body?.id, body?.name, body?.role, body?.password, operator) };
    }
    update(id, body, req) {
        const operator = req.agent;
        const patch = {};
        if (body?.name !== undefined)
            patch.name = body.name;
        if (body?.role !== undefined)
            patch.role = body.role;
        if (body?.active !== undefined)
            patch.active = Boolean(body.active);
        return { account: this.auth.update(id, patch, operator) };
    }
    resetPassword(id, body, req) {
        this.auth.resetPassword(id, body?.newPassword, req.agent);
        return { ok: true };
    }
    remove(id, req) {
        this.auth.removeAccount(id, req.agent);
        return { ok: true };
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AccountsController.prototype, "list", null);
__decorate([
    Post(),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AccountsController.prototype, "create", null);
__decorate([
    Patch(':id'),
    __param(0, Param('id')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], AccountsController.prototype, "update", null);
__decorate([
    Post(':id/reset-password'),
    __param(0, Param('id')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], AccountsController.prototype, "resetPassword", null);
__decorate([
    Delete(':id'),
    __param(0, Param('id')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AccountsController.prototype, "remove", null);
AccountsController = __decorate([
    UseGuards(AgentAuthGuard, AccountManagerGuard),
    Controller('api/accounts'),
    __metadata("design:paramtypes", [AuthService])
], AccountsController);
export { AccountsController };
//# sourceMappingURL=accounts.controller.js.map