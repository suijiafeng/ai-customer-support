import React, { useEffect, useState } from 'react';
import { login, type AgentIdentity } from '../api.js';

interface LoginProps {
  onLogin: (agent: AgentIdentity) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [agentNo, setAgentNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 登录限速（每分钟 5 次）触发后的剩余秒数：倒计时期间提示还要等多久，并禁用提交
  const [waitSeconds, setWaitSeconds] = useState(0);

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  useEffect(() => {
    if (waitSeconds === 0 && error.startsWith('尝试过于频繁')) setError('');
  }, [waitSeconds, error]);
  // 签到簿上的日期：真实本地日期，不做任何伪造的状态展示
  const now = new Date();
  const today = `${now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })} ${now.toLocaleDateString('zh-CN', { weekday: 'short' })}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentNo.trim() || !password || loading || waitSeconds > 0) return;
    setLoading(true);
    setError('');
    try {
      onLogin(await login(agentNo.trim(), password));
    } catch (err: any) {
      if (err?.status === 429) {
        const seconds = err?.retryAfter > 0 ? err.retryAfter : 60;
        setWaitSeconds(seconds);
        // 提示文案只在触发时写一次（role=alert 每次变化都会被读屏），倒计时放在按钮上
        setError(`尝试过于频繁，请 ${seconds} 秒后再试`);
      } else {
        setError('工号或密码错误');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <header className="login-head">
          <span className="login-mark">AssistFlow</span>
          <span className="login-duty">{today}</span>
        </header>
        <div className="login-brand">客服工作台</div>
        <p className="login-tip">请使用客服工号签到上岗</p>
        <label className="login-no-field">
          工号
          <input
            className="login-no"
            value={agentNo}
            autoFocus
            autoComplete="username"
            inputMode="numeric"
            placeholder="0000"
            onChange={(e) => setAgentNo(e.target.value)}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="请输入密码"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className={loading ? 'loading' : ''}
          disabled={!agentNo.trim() || !password || loading || waitSeconds > 0}
        >
          {loading ? '签到中…' : waitSeconds > 0 ? `${waitSeconds} 秒后可重试` : '签到上岗'}
        </button>
        <p className="login-foot">本地知识库优先 · 转人工由访客主动发起</p>
      </form>
    </div>
  );
}
