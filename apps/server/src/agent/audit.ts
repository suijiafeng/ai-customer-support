import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { StoreService } from '../store/store.service.js';

export interface ToolAuditEntry {
  id: string;
  sessionId: string;
  tenantKey: string | null;
  tool: string;
  /** 参数摘要，手机号和地址已脱敏。 */
  argsSummary: string;
  status: string;
  durationMs: number;
  demo: boolean;
  at: string;
}

const MAX_MEMORY = 500;

@Injectable()
export class AgentAuditService {
  private readonly entries: ToolAuditEntry[] = [];

  constructor(private readonly store?: StoreService) {}

  record(entry: Omit<ToolAuditEntry, 'id' | 'at'>): ToolAuditEntry {
    const saved: ToolAuditEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    this.entries.push(saved);
    if (this.entries.length > MAX_MEMORY) this.entries.shift();
    void this.store?.saveAgentAudit(saved);
    return saved;
  }

  /** 有数据库时以库为准，这样重启后工作台仍能看到记录。 */
  async forSession(sessionId: string): Promise<ToolAuditEntry[]> {
    if (this.store?.loadAgentAudit) {
      try {
        const stored = await this.store.loadAgentAudit(sessionId);
        if (Array.isArray(stored) && stored.length) return stored;
      } catch {
        /* 库不可用时退回本次进程里的记录 */
      }
    }
    return this.entries.filter((entry) => entry.sessionId === sessionId);
  }
}
