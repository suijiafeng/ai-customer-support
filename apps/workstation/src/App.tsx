import React, { useCallback, useMemo, useState } from 'react';
import { clearAuth, getStoredAgent, getToken, type AgentIdentity } from './api.js';
import { useQueueEvents } from './hooks/useQueueEvents.js';
import { useHistoryBack } from './hooks/useHistoryBack.js';
import SessionQueue from './components/SessionQueue.js';
import ChatPanel from './components/ChatPanel.js';
import Login from './components/Login.js';
import AgentMenu from './components/AgentMenu.js';
import OperationsPanel from './components/OperationsPanel.js';
import TenantsPanel from './components/TenantsPanel.js';
import ModelsPanel from './components/ModelsPanel.js';
import UsersPanel from './components/UsersPanel.js';
import FaqsPanel from './components/FaqsPanel.js';
import { FeedbackHost } from './ui/feedback.js';
import Icon from './ui/Icon.js';

export default function App() {
  // 客服身份来自登录态（JWT），未登录先进登录页
  const [agent, setAgent] = useState<AgentIdentity | null>(() =>
    getToken() ? getStoredAgent() : null
  );

  return (
    <>
      {agent
        ? <Workstation agent={agent} onLogout={() => { clearAuth(); setAgent(null); }} />
        : <Login onLogin={setAgent} />}
      <FeedbackHost />
    </>
  );
}

type View = 'sessions' | 'system';

type ViewDef = { key: View; label: string; icon: 'inbox' | 'building' };
const VIEWS: ViewDef[] = [
  { key: 'sessions', label: '会话接待', icon: 'inbox' },
  { key: 'system', label: '数据管理', icon: 'building' },
];

// 数据管理下的二级子菜单；数据概览人人可见，其余管理类功能仅 admin 可见。
// 后续新增管理功能（比如工单规则、公告管理）直接加进这个数组即可
type SystemSubView = 'ops' | 'tenants' | 'models' | 'users' | 'faqs';
type SystemSubViewDef = { key: SystemSubView; label: string; icon: 'bar-chart' | 'building' | 'zap' | 'user' | 'message-circle'; adminOnly?: boolean };
const SYSTEM_SUB_VIEWS: SystemSubViewDef[] = [
  { key: 'ops', label: '数据概览', icon: 'bar-chart' },
  { key: 'faqs', label: '知识库', icon: 'message-circle' },
  { key: 'tenants', label: '租户管理', icon: 'building', adminOnly: true },
  { key: 'models', label: '模型管理', icon: 'zap', adminOnly: true },
  { key: 'users', label: '用户管理', icon: 'user', adminOnly: true },
];

function Workstation({ agent, onLogout }: { agent: AgentIdentity; onLogout: () => void }) {
  const { sessions, connected, ready: queueReady } = useQueueEvents();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useHistoryBack(queueOpen, () => setQueueOpen(false));
  const [view, setView] = useState<View>('sessions');
  const [systemSubView, setSystemSubView] = useState<SystemSubView>('ops');
  // 移动端"数据管理"子菜单参照会话队列做成默认收起的抽屉
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const closeSystemMenu = useHistoryBack(systemMenuOpen, () => setSystemMenuOpen(false));
  // 租户/模型/用户管理仅 admin 可见；后端本身也会拒绝非 admin 请求，这里是双重保险
  const systemSubViews = useMemo(
    () => SYSTEM_SUB_VIEWS.filter((sv) => !sv.adminOnly || agent.role === 'admin'),
    [agent.role],
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === activeId) || null,
    [sessions, activeId],
  );

  // 选中会话后在移动端自动收起队列
  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    closeQueue();
  }, []);

  const poolCount = useMemo(
    () => sessions.filter((s) => !s.assignedAgentId && s.status !== 'closed').length,
    [sessions],
  );
  // 移动端侧栏即抽屉：会话接待时展示队列，数据管理时展示子菜单
  const sideOpen = view === 'sessions' ? queueOpen : systemMenuOpen;

  return (
    <div className="app">
      {/* 顶栏仅在移动端显示（汉堡 + 客服头像 + 底部 Tab）；桌面端导航全部收进左侧深色侧栏 */}
      <header className="topbar">
        <div className="topbar-left">
          {view === 'sessions' && (
            <button
              className="menu-btn"
              aria-label={queueOpen ? '收起会话队列' : '展开会话队列'}
              aria-expanded={queueOpen}
              onClick={() => queueOpen ? closeQueue() : setQueueOpen(true)}
            ><Icon name="menu" size={20} /></button>
          )}
          {view === 'system' && (
            <button
              className="menu-btn"
              aria-label={systemMenuOpen ? '收起数据管理菜单' : '展开数据管理菜单'}
              aria-expanded={systemMenuOpen}
              onClick={() => systemMenuOpen ? closeSystemMenu() : setSystemMenuOpen(true)}
            ><Icon name="menu" size={20} /></button>
          )}
          <button className="brand" type="button" onClick={() => setView('sessions')}>
            AssistFlow 客服工作台
          </button>
        </div>
        <nav className="view-tabs" aria-label="功能页签">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              aria-current={view === v.key}
              className={view === v.key ? 'active' : ''}
              onClick={() => setView(v.key)}
            >
              <Icon name={v.icon} size={14} />
              {v.label}
            </button>
          ))}
        </nav>
        <div className="menu-wraper">
          <AgentMenu agent={agent} sessions={sessions} connected={connected} onLogout={onLogout} />
        </div>
      </header>
      <div className="body">
        <aside className={`side${sideOpen ? ' open' : ''}`} aria-label="侧边栏">
          <div className="side-head">
            <button className="side-brand" type="button" onClick={() => setView('sessions')}>
              <span className="side-logo"><Icon name="brand" size={16} /></span>
              <span className="side-brand-text">
                <strong>客服工作台</strong>
                <small>
                  <i className={`side-dot${connected ? '' : ' off'}`} aria-hidden="true" />
                  {connected ? '实时连接' : '重连中'} · {poolCount} 位待接待
                </small>
              </span>
            </button>
            <nav className="side-nav" aria-label="功能页签">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  aria-current={view === v.key}
                  className={view === v.key ? 'active' : ''}
                  onClick={() => setView(v.key)}
                >
                  <Icon name={v.icon} size={16} />
                  {v.label}
                </button>
              ))}
            </nav>
          </div>
          {view === 'sessions' ? (
            <SessionQueue
              sessions={sessions}
              activeId={activeId}
              onSelect={handleSelect}
              open={queueOpen}
              agent={agent}
              ready={queueReady}
            />
          ) : (
            <nav className="admin-sidenav" aria-label="数据管理子菜单">
              <div className="side-section-label">数据管理</div>
              {systemSubViews.map((sv) => (
                <button
                  key={sv.key}
                  aria-current={systemSubView === sv.key}
                  className={systemSubView === sv.key ? 'active' : ''}
                  onClick={() => { setSystemSubView(sv.key); if (systemMenuOpen) closeSystemMenu(); }}
                >
                  <Icon name={sv.icon} size={16} />
                  {sv.label}
                </button>
              ))}
            </nav>
          )}
          <div className="side-foot">
            <AgentMenu agent={agent} sessions={sessions} connected={connected} onLogout={onLogout} variant="card" />
          </div>
        </aside>
        {sideOpen && (
          <div
            className="queue-overlay"
            onClick={view === 'sessions' ? closeQueue : closeSystemMenu}
            aria-hidden="true"
          />
        )}
        {view === 'sessions' && <ChatPanel session={activeSession} agent={agent} />}
        {view === 'system' && (
          <div className="admin-layout">
            {systemSubView === 'ops' && (
              <OperationsPanel agent={agent} onOpenSession={(id) => { setView('sessions'); handleSelect(id); }} />
            )}
            {systemSubView === 'tenants' && agent.role === 'admin' && <TenantsPanel />}
            {systemSubView === 'models' && agent.role === 'admin' && <ModelsPanel />}
            {systemSubView === 'users' && agent.role === 'admin' && <UsersPanel />}
            {systemSubView === 'faqs' && <FaqsPanel isAdmin={agent.role === 'admin'} />}
          </div>
        )}
      </div>
    </div>
  );
}
