import React, { useCallback, useEffect, useState } from 'react';
import { requestJson } from '../api.js';
import { showToast } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';

interface VendorInfo {
  key: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyConfigured: boolean;
  enabled: boolean;
}

interface ModelsData {
  active: { provider: string; model: string };
  vendors: VendorInfo[];
}

/** 模型管理：admin 专属。查看各厂商 Key 配置状态、启用开关，切换默认厂商/模型（实时生效）。 */
export default function ModelsPanel() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await requestJson<ModelsData>('/api/admin/models');
      setData(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (body: any, okMsg: string) => {
    setSaving(true);
    try {
      const res = await requestJson<{ settings: any }>('/api/admin/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      showToast(okMsg, 'success');
      await load();
      return res.settings;
    } catch (e: any) {
      showToast(e?.message || '保存失败', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const toggleEnabled = useCallback((vendor: VendorInfo) => {
    if (!data) return;
    const enabled: Record<string, boolean> = {};
    for (const v of data.vendors) enabled[v.key] = v.key === vendor.key ? !v.enabled : v.enabled;
    patch({ enabled }, vendor.enabled ? `已停用 ${vendor.label}` : `已启用 ${vendor.label}`);
  }, [data, patch]);

  const setDefault = useCallback((vendor: VendorInfo) => {
    patch(
      { defaultProvider: vendor.key, defaultModel: vendor.defaultModel },
      `默认模型已切换为 ${vendor.label} / ${vendor.defaultModel}`
    );
  }, [patch]);

  if (loading) return <main className="panel-page"><div className="empty">加载中…</div></main>;
  if (error || !data) {
    return (
      <main className="panel-page">
        <div className="empty">
          <Icon name="alert-triangle" size={28} style={{ opacity: 0.4, marginBottom: 4 }} />
          加载失败 <button type="button" className="link-btn" onClick={load}>重试</button>
        </div>
      </main>
    );
  }

  const activeVendor = data.vendors.find((v) => v.key === data.active.provider);

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">模型管理</h2>
          <span className="toolbar-hint">Key 在服务端 .env 配置，这里只做选用与切换，实时生效</span>
        </div>
        <button type="button" className="ghost-btn" onClick={load} disabled={saving} title="刷新">
          <Icon name="refresh" size={14} /> 刷新
        </button>
      </div>

      <section className="panel-block" aria-label="当前生效">
        <div className="active-model-bar">
          <span className="active-dot" />
          <span>当前默认：<strong>{activeVendor?.label || data.active.provider}</strong></span>
          <code className="mono">{data.active.model}</code>
        </div>
      </section>

      <section className="vendor-grid" aria-label="厂商列表">
        {data.vendors.map((v) => {
          const isActive = v.key === data.active.provider;
          return (
            <article key={v.key} className={`vendor-card${isActive ? ' is-active' : ''}${v.enabled ? '' : ' is-off'}`}>
              <div className="vendor-head">
                <h3>{v.label}</h3>
                <button
                  type="button"
                  role="switch"
                  aria-checked={v.enabled}
                  aria-label={`${v.label}启用开关`}
                  className={`switch${v.enabled ? ' on' : ''}`}
                  onClick={() => toggleEnabled(v)}
                  disabled={saving}
                >
                  <span className="knob" />
                </button>
              </div>
              <div className="vendor-meta">
                <span className={`tag ${v.keyConfigured ? 'tag-green' : 'tag-gray'}`}>
                  {v.keyConfigured ? 'Key 已配置' : 'Key 未配置'}
                </span>
                {isActive && <span className="tag tag-brand">默认</span>}
              </div>
              <div className="vendor-model">
                <code className="mono">{v.defaultModel}</code>
              </div>
              {!isActive && (
                <button
                  type="button"
                  className="link-btn"
                  disabled={saving || !v.keyConfigured}
                  title={v.keyConfigured ? '设为默认模型' : '请先在服务端配置该厂商的 Key'}
                  onClick={() => setDefault(v)}
                >
                  设为默认
                </button>
              )}
            </article>
          );
        })}
      </section>
      {!data.vendors.some((v) => v.keyConfigured) && (
        <p className="form-hint">没有任何厂商配置了 Key：请在服务端 .env 设置 <code className="mono">AI_API_KEY</code>（或 <code className="mono">&lt;厂商&gt;_API_KEY</code>）后刷新本页。</p>
      )}
    </main>
  );
}
