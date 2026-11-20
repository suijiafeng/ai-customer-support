import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { DailyMetricPoint, Metrics } from '@assistflow/shared';
import { SessionsService } from '../sessions/sessions.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { StoreService } from '../store/store.service.js';

function localDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessions: SessionsService,
    private readonly tickets: TicketsService,
    private readonly store: StoreService
  ) {}

  // 用 onApplicationBootstrap 而不是 onModuleInit：Nest 并行跑同模块的 onModuleInit，
  // 此时 SessionsService/TicketsService 还没从库里载入，首个快照会把今天的指标覆盖成 0。
  onApplicationBootstrap() {
    this.recordDaily();
    this.timer = setInterval(() => this.recordDaily(), 30 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** 按当前内存里的会话实时算出今天的点 */
  livePoint(now = new Date()): DailyMetricPoint {
    const m = this.buildMetrics();
    return {
      date: localDate(now),
      waiting: m.queue.waitingHuman,
      assigned: m.queue.assigned,
      activeSessions: m.workload.activeSessions,
    };
  }

  recordDaily(): void {
    this.store.saveDailyMetric(this.livePoint());
  }

  /**
   * 趋势：历史天数用库里的快照，今天用实时值。
   * 快照约 30 分钟写一次，启动时写的今天往往是 0，图上最后一段会掉到 0，看起来像数据异常。
   */
  async getTrend(days = 14, now = new Date()): Promise<DailyMetricPoint[]> {
    const today = this.livePoint(now);
    const stored = await this.store.loadDailyMetrics(days);
    const past = stored.filter((point) => point.date !== today.date);
    return [...past, today].slice(-days);
  }

  buildMetrics(): Metrics {
    const sessionList = this.sessions.list();
    const tickets = this.tickets.all;
    const totalSessions = sessionList.length;
    const automatedSessions = sessionList.filter(
      (session) => session.status === 'bot' && !session.needHuman
    ).length;
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
          ? Math.round(
              (sessionList.filter((session) => session.needHuman).length / totalSessions) * 100
            )
          : 0,
      },
      workload: {
        activeTickets: openTicketCount + processingTicketCount,
        activeSessions: sessionList.filter((session) => session.status !== 'closed').length,
      },
    };
  }
}
