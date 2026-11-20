import { Injectable } from '@nestjs/common';
import { LIMITS } from '@assistflow/shared';
import type { AgentActionCard, AgentTraceStep, Message, Ticket } from '@assistflow/shared';
import { AiService } from '../ai/ai.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { WidgetKeysService } from '../widget-keys/widget-keys.service.js';
import { AgentActionService } from './actions.js';
import { AgentAuditService } from './audit.js';
import { createBuiltinTools } from './builtin-tools.js';
import { DemoCommerce } from './commerce.js';
import { localPlanner } from './planner.js';
import { runAgentLoop, type LoopOutcome, type ModelMessage } from './loop.js';
import { openAiToolClient } from './openai-tools.js';
import { ToolRegistry } from './registry.js';

export interface AgentTurn {
  handled: boolean;
  reply: string;
  traces: AgentTraceStep[];
  action: AgentActionCard | null;
  handoff: boolean;
  ticket: Ticket | null;
  degraded: boolean;
}

@Injectable()
export class AgentService {
  readonly commerce = new DemoCommerce();
  readonly registry = new ToolRegistry();
  private readonly planner = localPlanner();

  constructor(
    private readonly tickets: TicketsService,
    private readonly actions: AgentActionService,
    private readonly audit: AgentAuditService,
    private readonly ai: AiService,
    private readonly widgetKeys?: WidgetKeysService,
  ) {
    for (const tool of createBuiltinTools(this.commerce, this.tickets)) this.registry.register(tool);
  }

  async handleUtterance(input: {
    message: string;
    sessionId: string;
    tenantKey: string | null;
    modelId?: string | null;
    /** 本条之前的对话，用来理解「那就改地址吧」这类承接上文的话 */
    history?: Message[];
    signal?: AbortSignal;
  }): Promise<AgentTurn | null> {
    this.applyTenantTools(input.tenantKey);
    const outcome = await runAgentLoop({
      message: input.message,
      history: toModelHistory(input.history),
      signal: input.signal,
      registry: this.registry,
      model: this.modelFor(input.modelId),
      ctx: { sessionId: input.sessionId, tenantKey: input.tenantKey, message: input.message },
      actions: this.actions,
      audit: this.audit,
    });
    if (!outcome.handled) return null;
    return this.toTurn(outcome);
  }

  async decide(input: { sessionId: string; actionId: string; decision: 'confirm' | 'cancel'; tenantKey: string | null; message: string }): Promise<AgentTurn> {
    this.applyTenantTools(input.tenantKey);
    const action = this.actions.get(input.actionId);
    if (!action || action.sessionId !== input.sessionId) {
      return { handled: true, reply: '没有找到这条待确认操作。', traces: [], action: null, handoff: false, ticket: null, degraded: false };
    }
    if (action.status !== 'pending') {
      return { handled: true, reply: '这条操作已经处理过了。', traces: [], action: { ...action }, handoff: false, ticket: null, degraded: false };
    }
    if (input.decision === 'cancel') {
      const cancelled = this.actions.mark(action.id, 'cancelled')!;
      this.audit.record({ sessionId: input.sessionId, tenantKey: input.tenantKey, tool: action.tool, argsSummary: '访客取消', status: 'cancelled', durationMs: 0, demo: action.demo });
      return { handled: true, reply: '已取消，没有修改订单。', traces: [], action: cancelled, handoff: false, ticket: null, degraded: false };
    }
    if (input.tenantKey && !this.registry.enabled(input.tenantKey, action.tool)) {
      return { handled: true, reply: '这个工具当前租户没有打开，订单没有改。', traces: [], action, handoff: false, ticket: null, degraded: true };
    }
    const tool = this.registry.get(action.tool);
    const started = Date.now();
    if (!tool) {
      this.actions.mark(action.id, 'failed');
      return { handled: true, reply: '这个工具已经不可用。', traces: [], action: { ...action, status: 'failed' }, handoff: false, ticket: null, degraded: true };
    }
    try {
      const result = await tool.execute(action.args, { sessionId: input.sessionId, tenantKey: input.tenantKey, message: input.message });
      const status = result.ok ? 'done' : 'failed';
      const marked = this.actions.mark(action.id, status)!;
      const trace: AgentTraceStep = { tool: action.tool, status: result.status, summary: result.summary, durationMs: Date.now() - started, demo: result.demo };
      this.audit.record({ sessionId: input.sessionId, tenantKey: input.tenantKey, tool: action.tool, argsSummary: '访客已确认', status: result.status, durationMs: trace.durationMs, demo: result.demo });
      return { handled: true, reply: result.summary, traces: [trace], action: marked, handoff: Boolean(result.handoff), ticket: null, degraded: !result.ok };
    } catch {
      this.actions.mark(action.id, 'failed');
      return { handled: true, reply: '确认后执行失败，订单没有改成。需要的话可以说「转人工」。', traces: [], action: { ...action, status: 'failed' }, handoff: false, ticket: null, degraded: true };
    }
  }

  private applyTenantTools(tenantKey: string | null) {
    if (!tenantKey) return;
    const flags = this.widgetKeys?.get(tenantKey)?.agentTools;
    if (flags) this.registry.setTenantTools(tenantKey, flags);
  }

  private modelFor(modelId?: string | null) {
    const client = this.ai.clientForModel(modelId);
    if (!client) return this.planner;
    return openAiToolClient(client, this.ai.connectionFor(modelId).model);
  }

  private toTurn(outcome: LoopOutcome): AgentTurn {
    return {
      handled: true,
      reply: outcome.text,
      traces: outcome.traces,
      action: outcome.pending,
      handoff: outcome.handoff,
      ticket: null,
      degraded: outcome.degraded,
    };
  }
}

/** 会话消息 → 模型历史：访客是 user，AI / 人工 / 系统提示都是 assistant；人工回复标明身份，避免模型以为是自己说的。 */
export function toModelHistory(history: Message[] = []): ModelMessage[] {
  return history
    .filter((m) => m.content && m.content.trim())
    .slice(-LIMITS.MAX_AI_HISTORY)
    .map((m) => m.role === 'user'
      ? { role: 'user' as const, content: m.content }
      : { role: 'assistant' as const, content: m.actor === 'agent' ? `（人工客服）${m.content}` : m.content });
}
