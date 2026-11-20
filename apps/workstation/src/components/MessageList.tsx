import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fmtTime, type UiMessage } from '../api.js';
import { Markdown } from '../ui/markdown.js';
import Icon from '../ui/Icon.js';

/**
 * 客服消息按真实发送者显示：只有当前登录客服自己发的才是「本」并且不写名字；
 * 管理员插话、同事接手前的回复都写明是谁，例如「管理员 · 客服9527」。
 */
function agentLabel(m: UiMessage): string {
  const name = m.agentName || m.agentId || '人工客服';
  return m.agentRole === 'admin' ? `管理员 · ${name}` : name;
}

function avatarText(m: UiMessage, mine: boolean): string {
  if (m.from === 'customer') return '访';
  if (m.from === 'ai') return 'AI';
  if (mine) return '本';
  if (m.agentRole === 'admin') return '管';
  const digits = String(m.agentName || m.agentId || '').match(/\d+/)?.[0];
  return digits ? digits.slice(-2) : '客';
}

// AI/客服消息按 Markdown 渲染；访客消息按纯文本（保留换行），避免把用户输入当 Markdown
function RichText({ text, markdown }: { text: string; markdown?: boolean }) {
  if (markdown) return <div className="txt"><Markdown text={text} /></div>;
  return <div className="txt md-plain">{text}</div>;
}

const MessageRow = memo(function MessageRow({ m, customerName, currentAgentId }: { m: UiMessage; customerName?: string; currentAgentId?: string }) {
  // 系统消息（接管提示 / 交还 AI 说明）：居中的一条灰底说明，不带头像和归属
  if (m.from === 'system') {
    return (
      <div className="row system">
        <div className="bubble">{m.content}</div>
      </div>
    );
  }
  const mine = m.from === 'agent' && Boolean(currentAgentId) && m.agentId === currentAgentId;
  const who = m.from === 'customer'
    ? (customerName || '访客')
    : m.from === 'ai' ? '智能助手' : agentLabel(m);
  const time = fmtTime(m.createdAt);
  const otherAgent = m.from === 'agent' && !mine;
  return (
    <div className={`row ${m.from}${otherAgent ? ' other-agent' : ''}`}>
      <div className={`avatar ${m.from}${otherAgent ? ' other' : ''}${m.agentRole === 'admin' && otherAgent ? ' admin' : ''}`} aria-hidden="true">{avatarText(m, mine)}</div>
      <div className="col">
        {!mine && <div className="meta">{who}</div>}
        <div className="bubble">
          {m.content && <RichText text={m.content} markdown={m.from !== 'customer'} />}
          {m.attachments?.length > 0 && (
            <div className="imgs">
              {m.attachments.map((a, j) => (
                <img
                  key={j}
                  src={a.dataUrl}
                  alt={a.name || '图片附件'}
                  onClick={() => window.open(a.dataUrl, '_blank')}
                />
              ))}
            </div>
          )}
        </div>
        {m.agentTrace && m.agentTrace.length > 0 && (
          <ul className="agent-trace">
            {m.agentTrace.map((step, index) => (
              <li key={`${step.tool}-${index}`}>
                {step.demo ? '演示数据 · ' : ''}{step.tool} · {step.status} · {step.summary} · {step.durationMs}ms
              </li>
            ))}
          </ul>
        )}
        {m.agentAction && (
          <div className="agent-trace">待确认：{m.agentAction.title}（{m.agentAction.status}）{m.agentAction.demo ? ' · 演示数据' : ''}</div>
        )}
        {time && <div className="time">{time}</div>}
      </div>
    </div>
  );
});

interface MessageListProps {
  messages: UiMessage[];
  customerName?: string;
  status?: 'loading' | 'ready' | 'error';
  /** 当前登录客服 id：只有他自己发的消息显示为「本」 */
  currentAgentId?: string;
}

export default function MessageList({ messages, customerName, status = 'ready', currentAgentId }: MessageListProps) {
  const listEl = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = listEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = listEl.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  // 新消息：贴底时自动跟随，否则保持位置（由“回到底部”按钮提示）
  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [messages, atBottom, scrollToBottom]);

  return (
    <div className="list-wrap">
      <div ref={listEl} className="msgs" role="log" aria-live="polite" aria-label="对话消息" onScroll={onScroll}>
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} customerName={customerName} currentAgentId={currentAgentId} />
        ))}
        {!messages.length && status === 'ready' && (
          <div className="empty"><Icon name="message-circle" size={28} style={{ opacity: .4, marginBottom: 4 }} />暂无消息，等待访客发起咨询</div>
        )}
      </div>
      {!atBottom && (
        <button className="to-bottom" onClick={() => { setAtBottom(true); scrollToBottom(); }} aria-label="回到底部">↓</button>
      )}
    </div>
  );
}
