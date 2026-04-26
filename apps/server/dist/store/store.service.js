var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var StoreService_1;
import { Injectable, Logger } from '@nestjs/common';
import { createStore } from './store.js';
let StoreService = StoreService_1 = class StoreService {
    logger = new Logger(StoreService_1.name);
    store = createStore();
    persisted = { sessions: [], conversations: [], tickets: [], widgetKeys: [] };
    readyResolve;
    // Nest 并行执行同模块的 onModuleInit，消费方必须 await 此 Promise 才能读到完整快照
    whenReady = new Promise((resolve) => {
        this.readyResolve = resolve;
    });
    get enabled() {
        return this.store.enabled;
    }
    getPersisted() {
        return this.persisted;
    }
    async onModuleInit() {
        try {
            await this.store.init();
            this.persisted = await this.store.loadAll();
            if (this.store.enabled) {
                const backend = (process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase();
                this.logger.log(`${backend} 持久化已启用，载入 ${this.persisted.sessions.length} 会话 / ${this.persisted.tickets.length} 工单`);
            }
        }
        catch (error) {
            this.logger.error(`初始化失败，降级为纯内存模式：${error?.message || error}`);
            this.store = createStore({ connectionString: null });
            this.persisted = { sessions: [], conversations: [], tickets: [], widgetKeys: [] };
        }
        finally {
            this.readyResolve();
        }
    }
    async onModuleDestroy() {
        await this.store.close();
    }
    saveSession = (session) => this.store.saveSession(session);
    saveConversation = (id, messages) => this.store.saveConversation(id, messages);
    saveTicket = (ticket) => this.store.saveTicket(ticket);
    saveWidgetKey = (key) => this.store.saveWidgetKey(key);
    deleteWidgetKey = (key) => this.store.deleteWidgetKey(key);
    loadSession = (id) => this.store.getSession(id);
    loadConversation = (id) => this.store.getConversation(id);
    saveDailyMetric = (point) => this.store.saveDailyMetric(point);
    loadDailyMetrics = (days) => this.store.loadDailyMetrics(days);
    get degraded() {
        return this.store.stats().writeErrors > 0;
    }
    stats() {
        return this.store.stats();
    }
};
StoreService = StoreService_1 = __decorate([
    Injectable()
], StoreService);
export { StoreService };
//# sourceMappingURL=store.service.js.map