import type { TicketsService } from '../tickets/tickets.service.js';
import type { CommerceAdapter } from './commerce.js';
import { publicOrder } from './commerce.js';
import type { AgentTool, ToolContext, ToolOutcome } from './registry.js';
import { maskAddress } from './redact.js';

const orderId = { type: 'string' as const, description: '订单号，例如 DEMO-9001', maxLength: 40 };

function denied(summary: string): ToolOutcome {
  return { ok: false, status: 'denied', summary, data: { error: 'forbidden' }, demo: true };
}

function missing(summary: string): ToolOutcome {
  return { ok: false, status: 'error', summary, data: { error: 'not_found' }, demo: true };
}

export function createBuiltinTools(commerce: CommerceAdapter, tickets: TicketsService): AgentTool[] {
  const queryOrder: AgentTool = {
    name: 'query_order',
    description: '查询当前访客自己的订单状态。不知道订单号时可以不传，返回该访客名下的演示订单。',
    permission: 'read',
    parameters: { type: 'object', properties: { orderId }, required: [], additionalProperties: false },
    async execute(args, ctx) {
      const id = String(args.orderId || '').trim();
      if (!id) {
        const orders = commerce.listOrders(ctx.sessionId).map(publicOrder);
        return { ok: true, status: 'ok', demo: true, summary: `演示数据：名下 ${orders.length} 张订单`, data: { demo: true, orders } };
      }
      const found = commerce.getOrder(id, ctx.sessionId);
      if (!found.ok) return found.error === 'forbidden' ? denied('这张订单不属于当前访客') : missing('没有这张订单');
      const order = publicOrder(found.order);
      return { ok: true, status: 'ok', demo: true, summary: `演示订单 ${order.id}：${order.status}`, data: { demo: true, order } };
    },
  };

  const queryLogistics: AgentTool = {
    name: 'query_logistics',
    description: '查询当前访客自己的订单物流。',
    permission: 'read',
    parameters: { type: 'object', properties: { orderId }, required: ['orderId'], additionalProperties: false },
    async execute(args, ctx) {
      const found = commerce.getOrder(String(args.orderId), ctx.sessionId);
      if (!found.ok) return found.error === 'forbidden' ? denied('这张订单不属于当前访客') : missing('没有这张订单');
      const order = publicOrder(found.order);
      return {
        ok: true,
        status: 'ok',
        demo: true,
        summary: `演示物流 ${order.carrier} ${order.tracking}`,
        data: { demo: true, carrier: order.carrier, tracking: order.tracking, status: order.status },
      };
    },
  };

  const createTicket: AgentTool = {
    name: 'create_ticket',
    description: '为当前会话创建跟进工单。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '工单原因', maxLength: 200 },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const reason = String(args.reason);
      const ticket = tickets.create({ sessionId: ctx.sessionId, message: ctx.message, intent: 'agent_tool', reason, inquiry: null });
      return { ok: true, status: 'ok', demo: false, summary: `已建工单 ${ticket.id}`, data: { ticketId: ticket.id, status: ticket.status } };
    },
  };

  const changeAddress: AgentTool = {
    name: 'change_address',
    description: '修改当前访客自己的订单收货地址。必须等访客确认后才真正改。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        orderId,
        address: { type: 'string', description: '新地址', maxLength: 120 },
      },
      required: ['orderId', 'address'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const found = commerce.updateAddress(String(args.orderId), ctx.sessionId, String(args.address));
      if (!found.ok) return found.error === 'forbidden' ? denied('这张订单不属于当前访客') : missing('没有这张订单');
      return { ok: true, status: 'ok', demo: true, summary: `演示订单地址已更新为 ${maskAddress(String(args.address))}`, data: { demo: true, order: publicOrder(found.order) } };
    },
  };

  const requestRefund: AgentTool = {
    name: 'request_refund',
    description: '为当前访客自己的订单申请退款。必须等访客确认后才提交。',
    permission: 'confirm',
    parameters: {
      type: 'object',
      properties: {
        orderId,
        reason: { type: 'string', description: '退款原因', maxLength: 200 },
      },
      required: ['orderId', 'reason'],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const found = commerce.requestRefund(String(args.orderId), ctx.sessionId, String(args.reason));
      if (!found.ok) return found.error === 'forbidden' ? denied('这张订单不属于当前访客') : missing('没有这张订单');
      return { ok: true, status: 'ok', demo: true, summary: `演示退款已受理 ${found.refundId}`, data: { demo: true, refundId: found.refundId, status: found.status } };
    },
  };

  const transferHuman: AgentTool = {
    name: 'transfer_human',
    description: '把当前会话转给人工客服。',
    permission: 'read',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: '转人工原因', maxLength: 200 } },
      required: [],
      additionalProperties: false,
    },
    async execute(args, ctx) {
      const reason = String(args.reason || ctx.message || '访客通过工具要求转人工');
      const ticket = tickets.create({ sessionId: ctx.sessionId, message: ctx.message, intent: 'human_handoff', reason, inquiry: null });
      return { ok: true, status: 'ok', demo: false, handoff: true, summary: `已转人工，工单 ${ticket.id}`, data: { ticketId: ticket.id } };
    },
  };

  return [queryOrder, queryLogistics, createTicket, changeAddress, requestRefund, transferHuman];
}

export function toolContext(sessionId: string, tenantKey: string | null, message: string): ToolContext {
  return { sessionId, tenantKey, message };
}
