var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { appConfig } from '../config.js';
import { AiService } from '../ai/ai.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { StoreService } from '../store/store.service.js';
import { MetricsService } from './metrics.service.js';
let MetaController = class MetaController {
    ai;
    knowledge;
    tickets;
    store;
    metrics;
    constructor(ai, knowledge, tickets, store, metrics) {
        this.ai = ai;
        this.knowledge = knowledge;
        this.tickets = tickets;
        this.store = store;
        this.metrics = metrics;
    }
    health() {
        const stats = this.store.stats();
        return {
            ok: true,
            aiEnabled: Boolean(this.ai.getActiveClient()),
            aiFeatureEnabled: appConfig.aiFeatureEnabled,
            aiConfigured: Boolean(this.ai.getConfiguredClient()),
            aiProvider: this.ai.provider,
            model: this.ai.getActiveModel(),
            faqCount: this.knowledge.faqs.length,
            inquiryCount: this.knowledge.inquiries.length,
            ticketCount: this.tickets.all.length,
            persistence: {
                backend: process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
                enabled: this.store.enabled,
                degraded: this.store.degraded,
                writeErrors: stats.writeErrors,
            },
        };
    }
    faqs() {
        return {
            faqs: this.knowledge.faqs.map(({ keywords: _keywords, ...rest }) => rest),
        };
    }
    metricsHandler() {
        return this.metrics.buildMetrics();
    }
    async trend() {
        return { trend: await this.metrics.getTrend(14) };
    }
    knowledgeStats() {
        return this.knowledge.getStats(20);
    }
};
__decorate([
    Get('health'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MetaController.prototype, "health", null);
__decorate([
    Get('faqs'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MetaController.prototype, "faqs", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Get('metrics'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MetaController.prototype, "metricsHandler", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Get('metrics/trend'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MetaController.prototype, "trend", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Get('knowledge/stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MetaController.prototype, "knowledgeStats", null);
MetaController = __decorate([
    Controller('api'),
    __metadata("design:paramtypes", [AiService,
        KnowledgeService,
        TicketsService,
        StoreService,
        MetricsService])
], MetaController);
export { MetaController };
//# sourceMappingURL=meta.controller.js.map