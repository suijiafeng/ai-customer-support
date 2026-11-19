import type { ModelClient, ModelMessage, ModelToolCall } from './loop.js';

/** 没配模型时只识别明确的办事说法，避免把普通问答改成工具调用。 */
export function planToolCall(message: string): ModelToolCall | null {
  const text = message.trim();
  const orderId = text.match(/DEMO-[A-Za-z0-9]+/)?.[0];
  if (/物流|快递/.test(text) && orderId) {
    return { id: 'plan-logistics', name: 'query_logistics', arguments: { orderId } };
  }
  if (/收货地址|改地址|修改地址/.test(text) && orderId) {
    const address = text.match(/改为(.+)$/)?.[1]?.trim() || '上海市徐汇区演示路 1 号';
    return { id: 'plan-address', name: 'change_address', arguments: { orderId, address } };
  }
  if (/退款|退货/.test(text) && orderId) {
    return { id: 'plan-refund', name: 'request_refund', arguments: { orderId, reason: '访客申请退款' } };
  }
  if (/工单/.test(text)) {
    return { id: 'plan-ticket', name: 'create_ticket', arguments: { reason: text.slice(0, 80) } };
  }
  if (/订单/.test(text)) {
    return { id: 'plan-order', name: 'query_order', arguments: orderId ? { orderId } : {} };
  }
  return null;
}

export function localPlanner(): ModelClient {
  return {
    async complete({ messages }) {
      const toolNotes = messages.filter((message) => message.role === 'tool');
      if (toolNotes.length) {
        return { text: summarizeToolData(toolNotes[toolNotes.length - 1].content), toolCalls: [] };
      }
      const user = [...messages].reverse().find((message) => message.role === 'user');
      const raw = user?.content || '';
      const spoken = raw.includes('访客消息：') ? raw.slice(raw.lastIndexOf('访客消息：') + '访客消息：'.length) : raw;
      const call = planToolCall(spoken);
      return call ? { text: '', toolCalls: [call] } : { text: '', toolCalls: [] };
    },
  };
}

function summarizeToolData(content: string): string {
  const jsonStart = content.indexOf('{');
  if (jsonStart < 0) return '办好了。';
  try {
    const data = JSON.parse(content.slice(jsonStart));
    if (data.error === 'forbidden') return '这张订单不属于当前访客，我不能查。';
    if (data.error === 'disabled') return '这个工具当前租户没有打开。';
    if (data.error === 'not_found') return '没有找到这张订单。';
    if (data.pendingActionId) return '这件事要你确认后我才会办。';
    if (data.order) return `演示数据：订单 ${data.order.id} 状态是${data.order.status}。`;
    if (data.orders) return `演示数据：查到 ${data.orders.length} 张属于你的订单。${data.orders.map((order: { id: string; status: string }) => `${order.id} ${order.status}`).join('；')}`;
    if (data.tracking) return `演示数据：物流 ${data.carrier}，单号 ${data.tracking}。`;
    if (data.ticketId) return `已记下，工单 ${data.ticketId}。`;
    if (data.refundId) return `演示数据：退款单 ${data.refundId} 已受理。`;
    return '办好了。演示数据仅供查看。';
  } catch {
    return '办好了。';
  }
}

export type { ModelMessage };
