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
import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { WidgetKeysService } from './widget-keys.service.js';
/** 租户管理（原 Widget 接入密钥）：仅 admin 可创建/启停/删除。 */
let WidgetKeysController = class WidgetKeysController {
    widgetKeys;
    constructor(widgetKeys) {
        this.widgetKeys = widgetKeys;
    }
    assertAdmin(agent) {
        if (agent.role !== 'admin') {
            throw new ForbiddenException({ error: 'admin only' });
        }
    }
    list(req) {
        this.assertAdmin(req.agent);
        return { keys: this.widgetKeys.list() };
    }
    create(body, req) {
        this.assertAdmin(req.agent);
        return { key: this.widgetKeys.create(body?.name, body?.key, body?.remark, body?.domain) };
    }
    update(key, body, req) {
        this.assertAdmin(req.agent);
        const patch = {};
        if (body?.name !== undefined)
            patch.name = body.name;
        if (body?.domain !== undefined)
            patch.domain = body.domain;
        if (body?.remark !== undefined)
            patch.remark = body.remark;
        if (body?.active !== undefined)
            patch.active = Boolean(body.active);
        return { key: this.widgetKeys.update(key, patch) };
    }
    stats(key, req) {
        this.assertAdmin(req.agent);
        return { stats: this.widgetKeys.getStats(key) };
    }
    remove(key, req) {
        this.assertAdmin(req.agent);
        this.widgetKeys.remove(key);
        return { ok: true };
    }
};
__decorate([
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WidgetKeysController.prototype, "list", null);
__decorate([
    Post(),
    __param(0, Body()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetKeysController.prototype, "create", null);
__decorate([
    Patch(':key'),
    __param(0, Param('key')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], WidgetKeysController.prototype, "update", null);
__decorate([
    Get(':key/stats'),
    __param(0, Param('key')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WidgetKeysController.prototype, "stats", null);
__decorate([
    Delete(':key'),
    __param(0, Param('key')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WidgetKeysController.prototype, "remove", null);
WidgetKeysController = __decorate([
    UseGuards(AgentAuthGuard),
    Controller('api/widget-keys'),
    __metadata("design:paramtypes", [WidgetKeysService])
], WidgetKeysController);
export { WidgetKeysController };
//# sourceMappingURL=widget-keys.controller.js.map