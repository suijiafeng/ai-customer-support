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
import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { SuperAdminGuard } from '../auth/roles.guard.js';
import { AiProvidersService } from './ai-providers.service.js';
/** 模型管理（AI 服务商配置）：仅系统管理员可读写。 */
let AiProvidersController = class AiProvidersController {
    providers;
    constructor(providers) {
        this.providers = providers;
    }
    list() {
        return { providers: this.providers.list() };
    }
    createCustom(body) {
        return { provider: this.providers.createCustom(pickInput(body)) };
    }
    upsert(id, body) {
        return { provider: this.providers.upsert(id, pickInput(body)) };
    }
    remove(id) {
        this.providers.remove(id);
        return { ok: true };
    }
    /** 测试连接并拉取模型列表；id 为内置/自定义服务商 id，未保存的草稿传 baseUrl/apiKey 即可 */
    async test(id, body) {
        const models = await this.providers.testConnection(id, {
            baseUrl: body?.baseUrl !== undefined ? String(body.baseUrl) : undefined,
            apiKey: body?.apiKey !== undefined ? String(body.apiKey) : undefined,
        });
        return { models };
    }
};
__decorate([
    Get(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AiProvidersController.prototype, "list", null);
__decorate([
    Post('custom'),
    __param(0, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AiProvidersController.prototype, "createCustom", null);
__decorate([
    Put(':id'),
    __param(0, Param('id')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AiProvidersController.prototype, "upsert", null);
__decorate([
    Delete(':id'),
    __param(0, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AiProvidersController.prototype, "remove", null);
__decorate([
    Post(':id/test'),
    __param(0, Param('id')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AiProvidersController.prototype, "test", null);
AiProvidersController = __decorate([
    UseGuards(AgentAuthGuard, SuperAdminGuard),
    Controller('api/ai-providers'),
    __metadata("design:paramtypes", [AiProvidersService])
], AiProvidersController);
export { AiProvidersController };
function pickInput(body) {
    const input = {};
    if (body?.name !== undefined)
        input.name = String(body.name);
    if (body?.baseUrl !== undefined)
        input.baseUrl = String(body.baseUrl);
    if (body?.apiKey !== undefined)
        input.apiKey = String(body.apiKey);
    if (body?.enabledModels !== undefined)
        input.enabledModels = body.enabledModels;
    if (body?.contextBudget !== undefined)
        input.contextBudget = body.contextBudget;
    return input;
}
//# sourceMappingURL=ai-providers.controller.js.map