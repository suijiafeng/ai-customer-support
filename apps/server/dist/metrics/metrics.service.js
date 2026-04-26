var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { StoreService } from '../store/store.service.js';
function localDate(d = new Date()) {
    return d.toLocaleDateString('en-CA');
}
let MetricsService = class MetricsService {
    sessions;
    tickets;
    store;
    timer = null;
    constructor(sessions, tickets, store) {
        this.sessions = sessions;
        this.tickets = tickets;
        this.store = store;
    }
    // 用 onApplicationBootstrap 而不是 onModuleInit：Nest 并行跑同模块的 onModuleInit，
    // 此时 SessionsService/TicketsService 还没从库里载入，首个快照会把今天的指标覆盖成 0。
    onApplicationBootstrap() {
        this.recordDaily();
        this.timer = setInterval(() => this.recordDaily(), 30 * 60 * 1000);
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    recordDaily() {
        const m = this.buildMetrics();
        const point = {
            date: localDate(),
            waiting: m.queue.waitingHuman,
            assigned: m.queue.assigned,
            activeSessions: m.workload.activeSessions,
        };
        this.store.saveDailyMetric(point);
    }
    getTrend(days = 14) {
        return this.store.loadDailyMetrics(days);
    }
    buildMetrics() {
        const sessionList = this.sessions.list();
        const tickets = this.tickets.all;
        const totalSessions = sessionList.length;
        const automatedSessions = sessionList.filter((session) => session.status === 'bot' && !session.needHuman).length;
        const openTicketCount = tickets.filter((ticket) => ticket.status === 'open').length;
        const processingTicketCount = tickets.filter((ticket) => ticket.status === 'processing').length;
        return {
            generatedAt: new Date().toISOString(),
            totals: {
                sessions: totalSessions,
                messages: this.sessions.messageCount,
                tickets: tickets.length,
            },
            queue: {
                waitingHuman: sessionList.filter((session) => session.status === 'waiting_human').length,
                assigned: sessionList.filter((session) => session.status === 'assigned').length,
                closed: sessionList.filter((session) => session.status === 'closed').length,
                highPriority: sessionList.filter((session) => session.priority === 'high').length,
            },
            tickets: {
                open: openTicketCount,
                processing: processingTicketCount,
                resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
                highPriority: tickets.filter((ticket) => ticket.priority === 'high').length,
            },
            ai: {
                automationRate: totalSessions ? Math.round((automatedSessions / totalSessions) * 100) : 100,
                handoffRate: totalSessions
                    ? Math.round((sessionList.filter((session) => session.needHuman).length / totalSessions) * 100)
                    : 0,
            },
            workload: {
                activeTickets: openTicketCount + processingTicketCount,
                activeSessions: sessionList.filter((session) => session.status !== 'closed').length,
            },
        };
    }
};
MetricsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SessionsService,
        TicketsService,
        StoreService])
], MetricsService);
export { MetricsService };
//# sourceMappingURL=metrics.service.js.map