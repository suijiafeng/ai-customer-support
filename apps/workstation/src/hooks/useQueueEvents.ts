import { useEffect, useState } from 'react';
import type { SessionSummary } from '@assistflow/shared';
import { SSE_BASE, fetchSseTicket, requestAuthRecheck, requestJson } from '../api.js';

// 会话队列实时订阅：优先 SSE（用 60s 短票据鉴权），断线/票据过期时降级轮询并自动重连。
export function useQueueEvents() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const startPolling = () => {
      if (pollTimer) return;
      const tick = async () => {
        try {
          const data = await requestJson<{ sessions: SessionSummary[] }>('/api/sessions');
          if (!closed) { setSessions(data.sessions || []); setReady(true); }
        } catch {
          /* 保留上次数据 */
        }
      };
      tick();
      pollTimer = setInterval(tick, 2000);
    };
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };

    // 用新票据建立 SSE；失败/过期则轮询兜底并定时用新票据重连
    // （票据 60s 过期，浏览器自带的自动重连会带旧票据反复失败，故自行重连）
    const connect = async () => {
      if (closed || typeof window.EventSource === 'undefined') {
        startPolling();
        return;
      }
      const scheduleReconnect = () => {
        if (!reconnectTimer && !closed) {
          reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5000);
        }
      };
      try {
        const ticket = await fetchSseTicket();
        if (closed) return;
        es = new EventSource(`${SSE_BASE}/api/sessions/events?ticket=${encodeURIComponent(ticket)}`);
        es.onopen = () => { setConnected(true); stopPolling(); };
        es.addEventListener('sessions', (e) => {
          try { setSessions(JSON.parse((e as MessageEvent).data).sessions || []); setReady(true); } catch {}
        });
        // 角色被管理员修改：服务端随后会按新权限补推快照，这里同步菜单
        es.addEventListener('role', () => requestAuthRecheck());
        // 账号失效（停用 / 删除 / 改密码）：服务端发完 revoked 就断开。核对身份，401 时回登录页
        es.addEventListener('revoked', () => {
          es?.close();
          es = null;
          setConnected(false);
          requestAuthRecheck();
        });
        es.onerror = () => {
          setConnected(false);
          es?.close();
          es = null;
          startPolling();
          scheduleReconnect();
        };
      } catch {
        startPolling();
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      closed = true;
      es?.close();
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return { sessions, connected, ready };
}
