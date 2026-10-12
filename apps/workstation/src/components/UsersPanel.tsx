import React, { useCallback, useEffect, useState } from 'react';
import { requestJson, getStoredAgent } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';

interface AgentUser {
  id: string;
  name: string;
  role: 'admin' | 'agent';
  active: boolean;
}

const EMPTY_FORM = { id: '', name: '', password: '', role: 'agent' as 'admin' | 'agent' };

/** 用户管理：admin 专属。客服账号增删改查、启停、重置密码。 */
export default function UsersPanel() {
  const [users, setUsers] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AgentUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const selfId = getStoredAgent()?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await requestJson<{ users: AgentUser[] }>('/api/admin/users');
      setUsers(res.users || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY_FORM); setShowCreate(true); };
  const openEdit = (u: AgentUser) => {
    setEditing(u);
    setForm({ id: u.id, name: u.name, password: '', role: u.role });
  };
  const closeForm = () => { setShowCreate(false); setEditing(null); setForm(EMPTY_FORM); };

  const submit = async () => {
    setSaving(true);
    try {
      if (editing) {
        const body: any = { name: form.name.trim(), role: form.role };
        if (form.password) body.password = form.password;
        const res = await requestJson<{ user: AgentUser }>(`/api/admin/users/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setUsers((list) => list.map((u) => (u.id === res.user.id ? res.user : u)));
        showToast('账号已更新', 'success');
      } else {
        const res = await requestJson<{ user: AgentUser }>('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: form.id.trim(),
            name: form.name.trim(),
            password: form.password,
            role: form.role,
          }),
        });
        setUsers((list) => [...list, res.user]);
        showToast('账号已创建', 'success');
      }
      closeForm();
    } catch (e: any) {
      showToast(e?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: AgentUser) => {
    try {
      const res = await requestJson<{ user: AgentUser }>(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !u.active }),
      });
      setUsers((list) => list.map((x) => (x.id === res.user.id ? res.user : x)));
      showToast(res.user.active ? '账号已启用' : '账号已停用', 'success');
    } catch (e: any) {
      showToast(e?.message || '操作失败', 'error');
    }
  };

  const remove = async (u: AgentUser) => {
    const ok = await confirmDialog(`确定删除账号 ${u.id}（${u.name}）吗？`);
    if (!ok) return;
    try {
      await requestJson(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
      setUsers((list) => list.filter((x) => x.id !== u.id));
      showToast('账号已删除', 'success');
    } catch (e: any) {
      showToast(e?.message || '删除失败', 'error');
    }
  };

  const formValid = editing
    ? form.name.trim().length > 0 && (form.password === '' || form.password.length >= 6)
    : /^[A-Za-z0-9_-]{3,32}$/.test(form.id.trim()) && form.name.trim().length > 0 && form.password.length >= 6;

  if (loading) return <main className="panel-page"><div className="empty">加载中…</div></main>;
  if (error) {
    return (
      <main className="panel-page">
        <div className="empty">
          <Icon name="alert-triangle" size={28} style={{ opacity: 0.4, marginBottom: 4 }} />
          加载失败 <button type="button" className="link-btn" onClick={load}>重试</button>
        </div>
      </main>
    );
  }

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">用户管理</h2>
          <span className="toolbar-hint">仅 admin 可见；停用后该账号无法登录</span>
        </div>
        <button type="button" className="primary-btn" onClick={openCreate}>+ 新建账号</button>
      </div>

      <section className="panel-block">
        <table className="data-table">
          <thead>
            <tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'is-inactive'}>
                <td><code className="mono">{u.id}</code>{u.id === selfId && <span className="tag tag-gray">我</span>}</td>
                <td>{u.name}</td>
                <td><span className={`tag ${u.role === 'admin' ? 'tag-brand' : 'tag-gray'}`}>{u.role === 'admin' ? '管理员' : '客服'}</span></td>
                <td><span className={`tag ${u.active ? 'tag-green' : 'tag-gray'}`}>{u.active ? '启用' : '停用'}</span></td>
                <td className="row-actions">
                  <button type="button" className="link-btn" onClick={() => openEdit(u)}>编辑</button>
                  <button type="button" className="link-btn" onClick={() => toggleActive(u)} disabled={u.id === selfId}>
                    {u.active ? '停用' : '启用'}
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => remove(u)} disabled={u.id === selfId}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <div className="empty">还没有账号，点击右上角新建</div>}
      </section>

      {(showCreate || editing) && (
        <div className="modal-mask" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={editing ? '编辑账号' : '新建账号'}>
            <h3>{editing ? `编辑账号 ${editing.id}` : '新建账号'}</h3>
            {!editing && (
              <label className="form-field">
                <span>账号 id（3-32 位字母/数字/_/-）</span>
                <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="kefu01" autoComplete="off" />
              </label>
            )}
            <label className="form-field">
              <span>姓名</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="小王" />
            </label>
            <label className="form-field">
              <span>角色</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'agent' })}>
                <option value="agent">客服</option>
                <option value="admin">管理员</option>
              </select>
            </label>
            <label className="form-field">
              <span>{editing ? '新密码（留空则不修改，至少 6 位）' : '密码（至少 6 位）'}</span>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={closeForm}>取消</button>
              <button type="button" className="primary-btn" disabled={!formValid || saving} onClick={submit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
