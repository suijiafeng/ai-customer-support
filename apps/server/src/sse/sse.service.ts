import { Injectable } from '@nestjs/common';
import { Observable, Subject, Subscription, concat, filter, interval, map, merge, of } from 'rxjs';

export interface SseMessage {
  type: string;
  data: unknown;
}

/** 推送前复核失败时发给客户端的最后一条事件，随后服务端关闭连接。 */
export const REVOKED_EVENT = 'revoked';
/** 角色被管理员修改：客户端应刷新身份（GET /api/auth/me）并更新菜单。 */
export const ROLE_EVENT = 'role';

export interface LiveIdentity {
  id: string;
  role: string;
}

export interface LiveStreamOptions<A extends LiveIdentity> {
  /** 建立连接时的身份 */
  initial: A;
  /** 按当前账号状态复核；返回 null 表示已停用 / 删除 / 改过密码 */
  recheck: () => A | null;
  /** 该账号发生变更时发出：不等下一条推送，立即复核 */
  changes$: Observable<unknown>;
  /** 按「当前」身份过滤或改写一条事件；返回 null 表示这条不发；返回 revoked 事件则发完即关 */
  project: (event: SseMessage, agent: A) => SseMessage | null;
  /** 角色变化后额外补发的事件（比如按新权限重算的队列快照） */
  onRoleChange?: (agent: A) => SseMessage | null;
}

@Injectable()
export class SseService {
  private readonly sessionEvents$ = new Subject<{ sessionId: string; payload: unknown }>();
  private readonly queueEvents$ = new Subject<unknown>();

  notifySession(sessionId: string, payload: unknown) {
    this.sessionEvents$.next({ sessionId, payload });
  }

  notifyQueue(payload: unknown) {
    this.queueEvents$.next(payload);
  }

  sessionStream(sessionId: string, initial: unknown): Observable<SseMessage> {
    const updates = this.sessionEvents$.pipe(
      filter((event) => event.sessionId === sessionId),
      map((event) => ({ type: 'session', data: event.payload }))
    );
    return concat(of({ type: 'session', data: initial }), merge(updates, heartbeat()));
  }

  queueStream(initial: unknown): Observable<SseMessage> {
    const updates = this.queueEvents$.pipe(map((payload) => ({ type: 'sessions', data: payload })));
    return concat(of({ type: 'sessions', data: initial }), merge(updates, heartbeat()));
  }

  /**
   * 客服侧长连接的权限闸门。鉴权只在建连时做一次是不够的：连接可以开几个小时，
   * 期间账号可能被停用、删除、降级或改密码，会话也可能被别的客服认领。
   * 这里在每条推送（含心跳）之前、以及账号变更的当下按「当前」身份复核：
   * - 身份失效：发一条 revoked 事件后结束流（Nest 随即关闭 HTTP 响应）；
   * - 角色变化：发 role 事件，之后的推送按新角色过滤；
   * - project 返回 revoked（例如会话已归别人）：发完即关。
   */
  live<A extends LiveIdentity>(source$: Observable<SseMessage>, options: LiveStreamOptions<A>): Observable<SseMessage> {
    return new Observable<SseMessage>((subscriber) => {
      let current = options.initial;
      let ended = false;
      const end = (event: SseMessage) => {
        if (ended) return;
        ended = true;
        subscriber.next(event);
        subscriber.complete();
      };
      const check = (): A | null => {
        if (ended) return null;
        const next = options.recheck();
        if (!next) {
          end({ type: REVOKED_EVENT, data: { reason: 'account_changed' } });
          return null;
        }
        const roleChanged = next.role !== current.role;
        current = next;
        if (roleChanged) {
          subscriber.next({ type: ROLE_EVENT, data: { role: next.role } });
          const extra = options.onRoleChange?.(next);
          if (extra) subscriber.next(extra);
        }
        return next;
      };
      const forward = (event: SseMessage) => {
        const agent = check();
        if (!agent) return;
        const out = options.project(event, agent);
        if (!out) return;
        if (out.type === REVOKED_EVENT) end(out);
        else subscriber.next(out);
      };
      const subs = new Subscription();
      subs.add(options.changes$.subscribe(() => check()));
      subs.add(
        source$.subscribe({
          next: forward,
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        })
      );
      return () => subs.unsubscribe();
    });
  }
}

function heartbeat(): Observable<SseMessage> {
  return interval(30000).pipe(map(() => ({ type: 'ping', data: '' })));
}
