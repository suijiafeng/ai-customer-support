import { createHash } from 'node:crypto';
import { redactRecord } from './redact.js';

export interface DemoOrder {
  id: string;
  ownerId: string;
  status: string;
  phone: string;
  address: string;
  carrier: string;
  tracking: string;
  /** 固定为 true：这是本地演示订单，不是外部业务系统。 */
  demo: true;
}

export interface CommerceAdapter {
  listOrders(ownerId: string): DemoOrder[];
  getOrder(orderId: string, ownerId: string): { ok: true; order: DemoOrder } | { ok: false; error: 'not_found' | 'forbidden' };
  updateAddress(orderId: string, ownerId: string, address: string): { ok: true; order: DemoOrder } | { ok: false; error: 'not_found' | 'forbidden' };
  requestRefund(orderId: string, ownerId: string, reason: string): { ok: true; refundId: string; status: string } | { ok: false; error: 'not_found' | 'forbidden' };
}

const FOREIGN_OWNER = 'v-other-visitor';

/** 本地演示订单。每个访客第一次查询时发两张属于自己的单，另有一张永远属于别人的单用来测越权。 */
export class DemoCommerce implements CommerceAdapter {
  private readonly orders = new Map<string, DemoOrder>();

  constructor() {
    this.orders.set('DEMO-9001', {
      id: 'DEMO-9001',
      ownerId: FOREIGN_OWNER,
      status: '待发货',
      phone: '13900001111',
      address: '北京市朝阳区别人的路 1 号',
      carrier: '演示快递',
      tracking: 'YTDEMO9001',
      demo: true,
    });
  }

  /** 访客 → 其演示订单号。避免每次都遍历全部订单判断「这个访客有没有单」。 */
  private readonly ownerOrders = new Map<string, string>();

  /**
   * 给访客发一张演示订单。订单号优先用会话 ID 末 4 位（好读、和已有演示保持一致），
   * 但不同访客的末 4 位可能相同：以前会直接覆盖别人的订单，等于把 A 的单「转」给了 B。
   * 现在撞号时改用会话 ID 的哈希，并逐步加长直到不冲突。
   */
  private ensureOwner(ownerId: string): void {
    if (this.ownerOrders.has(ownerId)) return;
    const tail = ownerId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'DEMO';
    let code = tail;
    if (this.orders.has(`DEMO-${code}01`)) {
      const hash = createHash('sha256').update(ownerId).digest('hex').toUpperCase();
      let len = 6;
      code = hash.slice(0, len);
      while (this.orders.has(`DEMO-${code}01`) && len < hash.length) {
        len += 2;
        code = hash.slice(0, len);
      }
    }
    const id = `DEMO-${code}01`;
    this.orders.set(id, {
      id,
      ownerId,
      status: '已发货',
      phone: '13812348000',
      address: '上海市徐汇区演示路 88 号',
      carrier: '演示快递',
      tracking: `YT${code}01`,
      demo: true,
    });
    this.ownerOrders.set(ownerId, id);
  }

  listOrders(ownerId: string): DemoOrder[] {
    this.ensureOwner(ownerId);
    return [...this.orders.values()].filter((order) => order.ownerId === ownerId);
  }

  getOrder(orderId: string, ownerId: string) {
    this.ensureOwner(ownerId);
    const order = this.orders.get(orderId.trim());
    if (!order) return { ok: false as const, error: 'not_found' as const };
    if (order.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const };
    return { ok: true as const, order };
  }

  updateAddress(orderId: string, ownerId: string, address: string) {
    const found = this.getOrder(orderId, ownerId);
    if (!found.ok) return found;
    found.order.address = address;
    return found;
  }

  requestRefund(orderId: string, ownerId: string, reason: string) {
    const found = this.getOrder(orderId, ownerId);
    if (!found.ok) return found;
    found.order.status = `退款处理中：${reason.slice(0, 40)}`;
    return { ok: true as const, refundId: `RF-${orderId}`, status: found.order.status };
  }
}

export function publicOrder(order: DemoOrder) {
  return redactRecord({ ...order });
}
