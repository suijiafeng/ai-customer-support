import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@assistflow/shared';
import { createMessageArchive } from '@assistflow/shared';
import { ApiError, SSE_BASE, fetchSseTicket, requestAuthRecheck, requestJson, normalizeMessages, type UiMessage } from '../api.js';

// 客服侧对话归档：服务端窗口外的旧消息留在工作台本地，合并渲染完整历史
const messageArchive = createMessageArchive(
  typeof window !== 'undefined' ? window.localStorage : undefined,
  'assistflow.agent-history'
);

export type HistoryStatus = 'loading' | 'ready' | 'error';
export type ConnectionStatus = 'syncing' | 'synced' | 'reconnecting' | 'revoked';

// 订阅单个会话的消息流：加载历史 + SSE 实时更新，切换会话自动重连。
// status:      loading | ready | error            —— 历史加载结果，决定列表区显示骨架/内容/重试
// connection:  syncing | synced | reconnecting | revoked —— SSE 实时通道状态；revoked = 已无权查看，不再重连
export function useSessionMessages(sessionId: string | null) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<HistoryStatus>('loading');
  const [connection, setConnection] = useState<ConnectionStatus>('syncing');
  const esRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);
  const everOpenRef = useRef(false);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    setStatus('loading');
    try {
      const data = await requestJson<{ messages: Message[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}`
      );
      if (!cancelledRef.current) {
        setMessages(normalizeMessages(messageArchive.merge(sessionId, data.messages) as Message[]));
        setStatus('ready');
      }
    } catch {
      if (!cancelledRef.current) setStatus('error');
    }
  }, [sessionId]);

  // 客服发送成功后用服务端返回刷新列表：与历史加载/SSE 走同一条归档合并路径，
  // 避免裸 setMessages 绕过 merge 导致窗口外历史被瞬时截断、或图片附件被后续快照抹掉
  const applyServer = useCallback((list: Message[]) => {
    if (!sessionId) return;
    setMessages(normalizeMessages(messageArchive.merge(sessionId, list) as Message[]));
    setStatus('ready');
  }, [sessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    everOpenRef.current = false;

    if (!sessionId) {
      setMessages([]);
      setStatus('ready');
      esRef.current?.close();
      return;
    }

    setConnection('syncing');
    setMessages([]);
    loadHistory();

    // 单会话 SSE 与队列 SSE 一样要带客服票据：服务端对会话读取强制鉴权
    // （客服 token 或访客令牌），不带凭证会被 403 挡下，UI 上表现为
    // 「连接中断，重连中…」且永远连不上。EventSource 无法自定义请求头，故走 ?ticket=。
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    const base = `${SSE_BASE}/api/sessions/${encodeURIComponent(sessionId)}/events`;

    const stop = (reason?: string) => {
      esRef.current?.close();
      esRef.current = null;
      if (cancelledRef.current) return;
      setConnection('revoked');
      if (reason === 'account_changed') requestAuthRecheck();
    };

    // 服务端拒绝（非 200，EventSource 进入 CLOSED，不会自己重连）或票据过期：
    // 用一次普通请求问清原因——401 由 requestJson 清空登录态；403 说明已无权查看，停止；
    // 其余情况换新票据重连，退避上限 30s。
    const recover = async () => {
      try {
        await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return stop();
      }
      if (cancelledRef.current) return;
      const delay = Math.min(30000, 1000 * 2 ** retries++);
      retryTimer = setTimeout(open, delay);
    };

    const connect = (es: EventSource) => {
      esRef.current = es;
      es.onopen = () => {
        if (cancelledRef.current) return;
        everOpenRef.current = true;
        retries = 0;
        setConnection('synced');
      };
      es.addEventListener('session', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          if (!cancelledRef.current) {
            setMessages(normalizeMessages(messageArchive.merge(sessionId, data.messages) as Message[]));
            setStatus('ready');
          }
        } catch {}
      });
      // 会话被别的客服认领 / 账号失效：服务端发 revoked 后断开，这里不再重连
      es.addEventListener('revoked', (event) => {
        let reason = '';
        try { reason = JSON.parse((event as MessageEvent).data)?.reason || ''; } catch {}
        stop(reason);
      });
      // 已经连上过再报错 = 断线重连中；从未连上 = 仍在初次连接
      es.onerror = () => {
        if (cancelledRef.current) return;
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null;
          setConnection(everOpenRef.current ? 'reconnecting' : 'syncing');
          recover();
          return;
        }
        setConnection(everOpenRef.current ? 'reconnecting' : 'syncing');
      };
    };

    const open = () => {
      if (cancelledRef.current) return;
      fetchSseTicket()
        .then((ticket) => {
          if (cancelledRef.current) return;
          connect(new EventSource(`${base}?ticket=${encodeURIComponent(ticket)}`));
        })
        .catch(() => {
          if (!cancelledRef.current) recover();
        });
    };
    open();

    return () => {
      cancelledRef.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      esRef.current?.close();
    };
  }, [sessionId, loadHistory]);

  return { messages, applyServer, status, connection, reload: loadHistory };
}
