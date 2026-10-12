import React, { useCallback, useEffect, useState } from 'react';
import { fmtTime, requestJson } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';

type KeySource = 'custom' | 'env' | 'optional' | 'none';

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  baseUrl: string;
  presetBaseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  /** 指定使用该模型的租户名 */
  tenants: string[];
  keySource: KeySource;
  keyMasked: string | null;
  updatedAt: string;
}

interface ProviderPreset {
  key: string;
  label: string;
  baseUrl: string;
  model: string;
  keyOptional: boolean;
}

interface ModelsData {
  defaultId: string;
  models: ModelRow[];
  providers: ProviderPreset[];
}

interface FormState {
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
}

const KEY_TAG: Record<KeySource, { text: string; cls: string }> = {
  custom: { text: '专属 Key', cls: 'tag-brand' },
  env: { text: '环境变量', cls: 'tag-green' },
  optional: { text: '无需 Key', cls: 'tag-gray' },
  none: { text: '未配置', cls: 'tag-warning' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(iso)}`;
}

/** 模型管理：admin 专属。模型配置增删改查、启停、设为默认（实时生效）；至少保留一个，默认模型不可删除/停用。 */
export default function ModelsPanel() {
  const [data, setData] = useState<ModelsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 抽屉表单：editing=null 且 showForm=true 为新增
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ModelRow | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await requestJson<ModelsData>('/api/admin/models');
      // 兼容旧版后端：缺少 tenants 字段时按「无租户占用」处理
      setData({ ...res, models: (res.models || []).map((m) => ({ ...m, tenants: m.tenants || [] })) });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const presetOf = (key: string) => data?.providers.find((p) => p.key === key);

  const openCreate = () => {
    const ds = presetOf('deepseek') || data?.providers[0];
    setEditing(null);
    setForm({ name: '', provider: ds?.key || 'deepseek', model: ds?.model || '', baseUrl: '', apiKey: '', clearApiKey: false, enabled: true });
    setShowForm(true);
  };

  const openEdit = (m: ModelRow) => {
    setEditing(m);
    setForm({ name: m.name, provider: m.provider, model: m.model, baseUrl: m.baseUrl, apiKey: '', clearApiKey: false, enabled: m.enabled });
    setShowForm(true);
  };

  const closeForm = () => { if (!saving) { setShowForm(false); setEditing(null); setForm(null); } };

  // 换厂商：模型 ID 为空或仍是旧厂商预设时，跟随新厂商的预设模型
  const changeProvider = (key: string) => {
    if (!form) return;
    const prev = presetOf(form.provider);
    const next = presetOf(key);
    const followModel = !form.model.trim() || form.model === prev?.model;
    setForm({ ...form, provider: key, model: followModel ? (next?.model || '') : form.model });
  };

  const submit = async () => {
    if (!form || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl,
        enabled: form.enabled,
      };
      if (form.clearApiKey) body.clearApiKey = true;
      else if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
      if (editing) {
        await requestJson(`/api/admin/models/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        showToast('模型已更新', 'success');
      } else {
        await requestJson('/api/admin/models', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        showToast('模型已添加', 'success');
      }
      setShowForm(false);
      setEditing(null);
      setForm(null);
      await load();
    } catch (e: any) {
      showToast(e?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runRowAction = async (id: string, action: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try {
      await action();
      showToast(okMsg, 'success');
      await load();
    } catch (e: any) {
      showToast(e?.message || '操作失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = (m: ModelRow) =>
    runRowAction(
      m.id,
      () => requestJson(`/api/admin/models/${encodeURIComponent(m.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !m.enabled }),
      }),
      m.enabled ? `已停用「${m.name}」` : `已启用「${m.name}」`,
    );

  const makeDefault = (m: ModelRow) =>
    runRowAction(
      m.id,
      () => requestJson(`/api/admin/models/${encodeURIComponent(m.id)}/default`, { method: 'POST' }),
      `默认模型已切换为「${m.name}」`,
    );

  const remove = async (m: ModelRow) => {
    const ok = await confirmDialog(`确认删除模型「${m.name}」（${m.model}）？删除后不可恢复。`, { confirmText: '删除' });
    if (!ok) return;
    runRowAction(
      m.id,
      () => requestJson(`/api/admin/models/${encodeURIComponent(m.id)}`, { method: 'DELETE' }),
      `已删除「${m.name}」`,
    );
  };

  if (loading) return <main className="panel-page"><div className="loading-center"><div className="spinner" /></div></main>;
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

  const onlyOne = data.models.length <= 1;
  const active = data.models.find((m) => m.isDefault);
  const formPreset = form ? presetOf(form.provider) : undefined;

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">模型管理</h2>
          <span className="toolbar-hint">兼容 OpenAI 接口；切换默认模型后实时生效，无需重启</span>
        </div>
        <button type="button" className="primary-btn" onClick={openCreate}>+ 新增模型</button>
      </div>

      {active && (
        <section className="panel-block" aria-label="当前默认模型">
          <div className="active-model-bar">
            <span className="active-dot" />
            <span>当前默认：<strong>{active.name}</strong></span>
            <code className="mono">{active.model}</code>
            <span className="muted">· {active.providerLabel}</span>
            {active.keySource === 'none' && <span className="tag tag-warning">Key 未配置，AI 将降级为本地规则回复</span>}
          </div>
        </section>
      )}

      <section className="panel-block">
        <div className="ticket-table-wrap">
          <table className="ticket-table model-table">
            <thead>
              <tr>
                <th>名称</th><th>厂商</th><th>模型 ID</th><th>接口地址</th><th>API Key</th><th>启用</th><th>更新时间</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m) => {
                const busy = busyId === m.id;
                const keyTag = KEY_TAG[m.keySource];
                const deleteBlock = onlyOne
                  ? '至少需要保留一个模型'
                  : m.isDefault
                    ? '默认模型不能删除，请先将其他模型设为默认'
                    : m.tenants.length
                      ? `正被 ${m.tenants.length} 个租户使用（${m.tenants.slice(0, 3).join('、')}${m.tenants.length > 3 ? ' 等' : ''}），请先在租户管理中更换`
                      : '';
                return (
                  <tr key={m.id} className={m.enabled ? '' : 'is-inactive'}>
                    <td>
                      <span className="model-name">{m.name}</span>
                      {m.isDefault && <span className="tag tag-brand">默认</span>}
                      {m.tenants.length > 0 && (
                        <div className="model-tenants" title={m.tenants.join('、')}>{m.tenants.length} 个租户指定使用</div>
                      )}
                    </td>
                    <td>{m.providerLabel}</td>
                    <td><code className="mono">{m.model}</code></td>
                    <td className="model-url">
                      {m.baseUrl
                        ? <span className="mono" title={m.baseUrl}>{m.baseUrl}</span>
                        : <span className="muted" title={m.presetBaseUrl || 'OpenAI 官方地址'}>跟随预设</span>}
                    </td>
                    <td>
                      <span className={`tag ${keyTag.cls}`}>{keyTag.text}</span>
                      {m.keyMasked && <span className="mono muted model-key">{m.keyMasked}</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.enabled}
                        aria-label={`${m.name}启用开关`}
                        className={`switch${m.enabled ? ' on' : ''}`}
                        onClick={() => toggleEnabled(m)}
                        disabled={busy || m.isDefault}
                        title={m.isDefault ? '默认模型不能停用' : undefined}
                      >
                        <span className="knob" />
                      </button>
                    </td>
                    <td className="muted">{fmtDate(m.updatedAt)}</td>
                    <td>
                      <div className="ops">
                        {!m.isDefault && (
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={busy || !m.enabled}
                            title={m.enabled ? '设为默认模型' : '请先启用该模型'}
                            onClick={() => makeDefault(m)}
                          >
                            设为默认
                          </button>
                        )}
                        <button type="button" className="ghost-btn" disabled={busy} onClick={() => openEdit(m)}>编辑</button>
                        <button
                          type="button"
                          className="ghost-btn remove"
                          disabled={busy || Boolean(deleteBlock)}
                          title={deleteBlock || '删除模型'}
                          onClick={() => remove(m)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="form-hint model-rules">
          规则：至少保留一个模型；默认模型不能删除或停用；被租户指定的模型需先在租户管理中更换才能删除（停用后这些租户自动回退默认模型）。API Key 留空时使用服务端环境变量（<code className="mono">&lt;厂商&gt;_API_KEY</code> 或 <code className="mono">AI_API_KEY</code>）。
        </p>
      </section>

      {showForm && form && (
        <div className="modal-mask drawer-mask" onClick={closeForm}>
          <div className="modal drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={editing ? '编辑模型' : '新增模型'}>
            <h3>{editing ? '编辑模型' : '新增模型'}</h3>
            <label className="form-field">
              <span>名称</span>
              <input value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={formPreset?.label || '如：DeepSeek 对话'} />
            </label>
            <label className="form-field">
              <span>厂商</span>
              <select value={form.provider} onChange={(e) => changeProvider(e.target.value)}>
                {data.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>模型 ID</span>
              <input className="mono" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={formPreset?.model || 'model-id'} />
            </label>
            <label className="form-field">
              <span>接口地址{form.provider === 'custom' ? '（必填）' : '（可选）'}</span>
              <input
                className="mono"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder={formPreset?.baseUrl || (form.provider === 'custom' ? 'https://your-llm.example.com/v1' : 'OpenAI 官方地址')}
              />
            </label>
            <p className="form-hint">留空使用厂商预设地址。</p>
            <label className="form-field">
              <span>API Key（可选）</span>
              <input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                disabled={form.clearApiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={editing?.keyMasked ? `已配置 ${editing.keyMasked}，留空不修改` : '留空使用环境变量'}
              />
            </label>
            {editing?.keySource === 'custom' && (
              <label className="check-row">
                <input type="checkbox" checked={form.clearApiKey} onChange={(e) => setForm({ ...form, clearApiKey: e.target.checked, apiKey: '' })} />
                清除专属 Key，改用环境变量
              </label>
            )}
            <p className="form-hint">Key 只保存在服务端，列表中仅显示末 4 位。</p>
            <div className="form-field">
              <span>启用</span>
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                className={`switch${form.enabled ? ' on' : ''}`}
                disabled={editing?.isDefault}
                title={editing?.isDefault ? '默认模型不能停用' : undefined}
                onClick={() => setForm({ ...form, enabled: !form.enabled })}
              >
                <span className="knob" />
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={closeForm} disabled={saving}>取消</button>
              <button
                type="button"
                className={`primary-btn${saving ? ' loading' : ''}`}
                disabled={saving || !form.model.trim() || (form.provider === 'custom' && !form.baseUrl.trim())}
                onClick={submit}
              >
                {saving ? '保存中…' : editing ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
