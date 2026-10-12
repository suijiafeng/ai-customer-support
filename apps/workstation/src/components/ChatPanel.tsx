import React, { useEffect, useMemo, useState } from 'react';
import { useHistoryBack } from '../hooks/useHistoryBack.js';
import type { SessionSummary } from '@assistflow/shared';
import MessageList from './MessageList.js';
import Composer from './Composer.js';
import SessionDetail from './SessionDetail.js';
import Icon from '../ui/Icon.js';
import EmptyState from '../ui/EmptyState.js';
import { useSessionMessages, type ConnectionStatus } from '../hooks/useSessionMessages.js';
import { type AgentIdentity } from '../api.js';

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  synced: '消息已同步',
  syncing: '正在同步…',
  reconnecting: '连接中断，重连中…',
};

// 会话接待状态标签（头部右侧）
const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  bot: { label: 'AI 接待中', tone: 'ai' },
  waiting_human: { label: '待人工', tone: 'warn' },
  assigned: { label: '人工接待', tone: 'human' },
  closed: { label: '已结束', tone: 'muted' },
  resolved: { label: '已结束', tone: 'muted' },
};

// 宽屏下详情栏常驻右侧（设计稿三栏布局）；窄屏仍是按需弹出的浮层
const DOCK_QUERY = '(min-width: 1280px)';
function useDockedDetail(): boolean {
  const [docked, setDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const onChange = () => setDocked(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return docked;
}

function pageHost(url?: string | null): string {
  if (!url) return '';
  try { return new URL(url).host; } catch { return ''; }
}

interface ChatPanelProps {
  session: SessionSummary | null;
  agent: AgentIdentity;
}

export default function ChatPanel({ session, agent }: ChatPanelProps) {
  const sessionId = session?.sessionId || null;
  const { messages, applyServer, status, connection, reload } = useSessionMessages(sessionId);
  const docked = useDockedDetail();
  // 浮层模式（窄屏）：打开时压一条 history，安卓返回键可关闭
  const [showDetail, setShowDetail] = useState(false);
  const closeDetail = useHistoryBack(showDetail && !docked, () => setShowDetail(false));
  // 停靠模式（宽屏）：默认展开，收起/展开不进 history
  const [dockOpen, setDockOpen] = useState(true);
  const detailVisible = docked ? dockOpen : showDetail;
  const toggleDetail = () => {
    if (docked) setDockOpen((v) => !v);
    else if (showDetail) closeDetail();
    else setShowDetail(true);
  };
  const hideDetail = () => (docked ? setDockOpen(false) : closeDetail());
  const canResolve = useMemo(
    () => Boolean(session && (agent.role === 'admin' || session.assignedAgentId === agent.id)),
    [session, agent.role, agent.id],
  );

  if (!session) {
    return (
      <main className="chat">
        <EmptyState
          icon="chat"
          title="还没有选中会话"
          hint={<>
            <span className="empty-hint-desktop">从左侧选择一个会话开始接待</span>
            <span className="empty-hint-mobile">点击左上角 ≡ 选择待接访客</span>
          </>}
        />
      </main>
    );
  }

  const pill = STATUS_PILL[session.status] || STATUS_PILL.bot;
  const host = pageHost(session.visitor?.pageUrl);

  return (
    <main className="chat">
      <div className="chat-head">
        <div className="chat-head-main">
          <button
            className="chat-head-name"
            title={detailVisible ? '收起详情' : '查看会话详情'}
            onClick={toggleDetail}
          >
            {session.displayName}
          </button>
          <span className="chat-head-sub">
            <span className={`conn conn-${connection}`}>{CONNECTION_LABEL[connection] || connection}</span>
            {host && <span className="chat-head-from">来自 {host}</span>}
          </span>
        </div>
        <div className="chat-head-actions">
          <span className={`status-pill status-pill--${pill.tone}`}>
            {pill.label}
            {session.status === 'assigned' && session.assignedAgentName ? ` · ${session.assignedAgentName}` : ''}
          </span>
          <button
            className={`head-icon-btn${detailVisible ? ' active' : ''}`}
            aria-pressed={detailVisible}
            aria-label={detailVisible ? '收起会话详情' : '展开会话详情'}
            title={detailVisible ? '收起会话详情' : '展开会话详情'}
            onClick={toggleDetail}
          >
            <Icon name="panel-right" size={16} />
          </button>
        </div>
      </div>
      <div className="chat-body">
        <div className="chat-main">
          {status === 'error' ? (
            <div className="state-block">
              <Icon name="alert-triangle" size={24} style={{ color: '#f59e0b' }} />
              <p>历史消息加载失败</p>
              <button className="retry-btn" onClick={reload}>重试</button>
            </div>
          ) : (
            <MessageList messages={messages} customerName={session.displayName} status={status} />
          )}
          {!session.assignedAgentId && session.status !== 'closed' && (
            <div className="claim-hint-bar" role="status">
              发送消息即接待并归入「我的会话」
            </div>
          )}
          <Composer sessionId={sessionId} agent={agent} onSent={applyServer} />
        </div>
        {detailVisible && (
          <>
            {!docked && <div className="detail-overlay" aria-hidden="true" onClick={closeDetail} />}
            <SessionDetail
              session={session}
              onClose={hideDetail}
              canResolve={canResolve}
              docked={docked}
            />
          </>
        )}
      </div>
    </main>
  );
}
