import React, { useEffect, useState } from 'react';
import { API, login, type AgentIdentity } from '../api.js';
import loginBg from '../assets/login-bg.webp';

interface LoginProps {
  onLogin: (agent: AgentIdentity) => void;
}

const REMEMBER_KEY = 'assistflow-remember-agent-no';

function readRememberedAgentNo(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) || '';
  } catch {
    return '';
  }
}

function persistRememberedAgentNo(agentNo: string, remember: boolean) {
  try {
    if (remember && agentNo) localStorage.setItem(REMEMBER_KEY, agentNo);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* 隐私模式等写不进去时忽略 */
  }
}

const BUBBLE_PATH =
  'M7 6h14a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5h-6.2L8 29.2V24H7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5z';

const WAVE_A =
  'M0,92 C180,150 360,34 540,92 C720,150 900,34 1080,92 C1260,150 1380,60 1440,80 L1440,200 L0,200 Z';
const WAVE_B =
  'M0,110 C200,50 400,160 600,110 C800,60 1000,160 1200,110 C1320,84 1380,96 1440,110 L1440,200 L0,200 Z';

export default function Login({ onLogin }: LoginProps) {
  const remembered = readRememberedAgentNo();
  const [agentNo, setAgentNo] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 登录限速（每分钟 5 次）触发后的剩余秒数：倒计时期间提示还要等多久，并禁用提交
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [demoLogin, setDemoLogin] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API}/api/auth/demo-login`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted) setDemoLogin(data?.enabled === true);
      })
      .catch(() => { if (!controller.signal.aborted) setDemoLogin(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  useEffect(() => {
    if (waitSeconds === 0 && error.startsWith('尝试过于频繁')) setError('');
  }, [waitSeconds, error]);

  // 页脚日期用真实本地时间，不硬编码
  const now = new Date();
  const year = now.getFullYear();
  const today = `${now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })} ${now.toLocaleDateString('zh-CN', { weekday: 'short' })}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentNo.trim() || !password || loading || waitSeconds > 0) return;
    setLoading(true);
    setError('');
    try {
      const agent = await login(agentNo.trim(), password);
      persistRememberedAgentNo(agentNo.trim(), remember);
      onLogin(agent);
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

  const onRememberChange = (checked: boolean) => {
    setRemember(checked);
    if (!checked) persistRememberedAgentNo('', false);
  };

  return (
    <div className="login-page">
      <div
        className="login-bg"
        style={{ backgroundImage: `url(${loginBg})` }}
        aria-hidden="true"
      />
      <div className="login-blob login-blob-1" aria-hidden="true" />
      <div className="login-blob login-blob-2" aria-hidden="true" />
      <div className="login-blob login-blob-3" aria-hidden="true" />
      <div className="login-bubbles" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className={`login-bubble login-bubble-${n}`}>
            <svg viewBox="0 0 32 32" fill="currentColor">
              <path d={BUBBLE_PATH} />
            </svg>
          </div>
        ))}
      </div>
      <div className="login-waves" aria-hidden="true">
        <div className="login-wave-track login-wave-a">
          <WavePath fill="rgba(20,184,166,0.16)" d={WAVE_A} />
          <WavePath fill="rgba(20,184,166,0.16)" d={WAVE_A} />
        </div>
        <div className="login-wave-track login-wave-b">
          <WavePath fill="rgba(45,212,191,0.14)" d={WAVE_B} />
          <WavePath fill="rgba(45,212,191,0.14)" d={WAVE_B} />
        </div>
      </div>

      <div className="login-left">
        <div className="login-left-brand">
          <span className="login-logo" aria-hidden="true">✦</span>
          AssistFlow
        </div>
        <div className="login-hero">
          <h1 className="login-hero-title">
            AI 先答，人工兜底
            <br />
            让每位客户都被及时回应
          </h1>
          <p>
            智能客服与人工坐席协同的工作台：AI 自动处理常见问题，复杂诉求实时转接给你。
          </p>
          <ul className="login-feats">
            <li><span className="login-feat-dot" aria-hidden="true">✓</span>AI 流式应答，命中知识库自动回复</li>
            <li><span className="login-feat-dot" aria-hidden="true">✓</span>一键转人工，会话实时同步</li>
            <li><span className="login-feat-dot" aria-hidden="true">✓</span>工单跟进与数据概览一站完成</li>
          </ul>
        </div>
        <div className="login-copy">© {year} AssistFlow · {today}</div>
      </div>

      <div className="login-right">
        <form className="login-card" onSubmit={submit}>
          <h2 className="login-card-title">客服工作台</h2>
          <p className="login-tip">请使用客服工号签到上岗</p>
          {demoLogin && (
            <button type="button" onClick={() => { setAgentNo('9527'); setPassword('123456'); }}>
              填入演示账号
            </button>
          )}

          <label className="login-field">
            工号
            <span className="login-input">
              <UserIcon />
              <input
                className="login-no"
                value={agentNo}
                autoFocus={!remembered}
                autoComplete="username"
                inputMode="numeric"
                placeholder="请输入工号"
                onChange={(e) => setAgentNo(e.target.value)}
              />
            </span>
          </label>

          <label className="login-field">
            密码
            <span className="login-input">
              <LockIcon />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoFocus={Boolean(remembered)}
                autoComplete="current-password"
                placeholder="请输入密码"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? '隐藏' : '显示'}
              </button>
            </span>
          </label>

          <div className="login-row">
            <label className="login-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => onRememberChange(e.target.checked)}
              />
              记住工号
            </label>
            <span className="login-forgot">忘记密码请联系管理员</span>
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className={`login-submit${loading ? ' loading' : ''}`}
            disabled={!agentNo.trim() || !password || loading || waitSeconds > 0}
          >
            {loading ? '签到中…' : waitSeconds > 0 ? `${waitSeconds} 秒后可重试` : '签到上岗'}
          </button>
          <p className="login-foot">本地知识库优先 · 转人工由访客主动发起</p>
        </form>
      </div>
    </div>
  );
}

function WavePath({ fill, d }: { fill: string; d: string }) {
  return (
    <svg viewBox="0 0 1440 200" preserveAspectRatio="none">
      <path fill={fill} d={d} />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="login-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
