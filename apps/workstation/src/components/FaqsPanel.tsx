import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Faq } from '@assistflow/shared';
import { requestJson } from '../api.js';
import { showToast, confirmDialog } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';

const EMPTY_FORM = { question: '', intent: '', answer: '', keywords: '' };

/** 知识库：FAQ 增删改查、意图筛选、JSON 导入导出。列表查询放行给客服，写操作仅 admin。 */
export default function FaqsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [faqs, setFaqs] = useState<Faq[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Faq | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (intent) params.set('intent', intent);
      const res = await requestJson<{ faqs: Faq[]; total: number }>(`/api/admin/faqs?${params}`);
      setFaqs(res.faqs || []);
      setTotal(res.total || 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [query, intent]);

  useEffect(() => { load(); }, [load]);

  const intents = useMemo(() => {
    const set = new Set<string>();
    for (const f of faqs) if (f.intent) set.add(f.intent);
    return [...set].sort();
  }, [faqs]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (f: Faq) => {
    setEditing(f);
    setForm({ question: f.question, intent: f.intent || '', answer: f.answer, keywords: (f.keywords || []).join('，') });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); };

  const parseKeywords = (s: string): string[] =>
    [...new Set(s.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean))].slice(0, 20);

  const submit = async () => {
    const body = {
      question: form.question.trim(),
      answer: form.answer.trim(),
      keywords: parseKeywords(form.keywords),
      ...(form.intent.trim() ? { intent: form.intent.trim() } : {}),
    };
    if (!body.question || !body.answer) {
      showToast('问题和回答不能为空', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await requestJson<{ faq: Faq }>(`/api/admin/faqs/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setFaqs((list) => list.map((f) => (f.id === res.faq.id ? res.faq : f)));
        showToast('已更新', 'success');
      } else {
        const res = await requestJson<{ faq: Faq }>('/api/admin/faqs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        setFaqs((list) => [res.faq, ...list]);
        setTotal((t) => t + 1);
        showToast('已新增', 'success');
      }
      closeForm();
    } catch (e: any) {
      showToast(e?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: Faq) => {
    const ok = await confirmDialog(`确定删除「${f.question}」吗？`);
    if (!ok) return;
    try {
      await requestJson(`/api/admin/faqs/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      setFaqs((list) => list.filter((x) => x.id !== f.id));
      setTotal((t) => t - 1);
      showToast('已删除', 'success');
    } catch (e: any) {
      showToast(e?.message || '删除失败', 'error');
    }
  };

  const exportJson = async () => {
    try {
      const res = await requestJson<{ faqs: Faq[] }>('/api/admin/faqs');
      const blob = new Blob([JSON.stringify(res.faqs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `faqs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      showToast(e?.message || '导出失败', 'error');
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const items = JSON.parse(text);
      if (!Array.isArray(items)) {
        showToast('文件内容不是 FAQ 数组', 'error');
        return;
      }
      const mode = await confirmDialog(
        `导入 ${items.length} 条 FAQ，请选择模式：\n「确定」= 整包替换（清空现有）\n「取消」= 按 id 合并（存在则更新）`
      ) ? 'replace' : 'merge';
      const res = await requestJson<{ count: number }>('/api/admin/faqs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faqs: items, mode }),
      });
      showToast(`导入完成，当前共 ${res.count} 条`, 'success');
      await load();
    } catch (e: any) {
      showToast(e?.message || '导入失败', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">知识库</h2>
          <span className="toolbar-hint">{total} 条问答 · 改动实时生效，无需重启</span>
        </div>
        <div className="toolbar-actions">
          {isAdmin && (
            <>
              <button type="button" className="ghost-btn" onClick={exportJson}>
                <Icon name="refresh" size={14} /> 导出 JSON
              </button>
              <button type="button" className="ghost-btn" onClick={() => fileRef.current?.click()}>
                导入 JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); }}
              />
              <button type="button" className="primary-btn" onClick={openCreate}>+ 新增问答</button>
            </>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索问题 / 关键词…"
            aria-label="搜索问答"
          />
        </div>
        <div className="chip-row" role="group" aria-label="意图筛选">
          <button type="button" className={`chip${intent === '' ? ' active' : ''}`} onClick={() => setIntent('')}>全部</button>
          {intents.map((it) => (
            <button key={it} type="button" className={`chip${intent === it ? ' active' : ''}`} onClick={() => setIntent(intent === it ? '' : it)}>
              {it}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : error ? (
        <div className="empty">
          <Icon name="alert-triangle" size={28} style={{ opacity: 0.4, marginBottom: 4 }} />
          加载失败 <button type="button" className="link-btn" onClick={load}>重试</button>
        </div>
      ) : faqs.length === 0 ? (
        <div className="empty">
          <Icon name="message-circle" size={28} style={{ opacity: 0.4, marginBottom: 4 }} />
          {query || intent ? '没有找到相关问答' : '还没有问答条目'}
          {isAdmin && !query && !intent && (
            <div><button type="button" className="link-btn" onClick={openCreate}>新增第一条</button></div>
          )}
        </div>
      ) : (
        <section className="faq-list" aria-label="问答列表">
          {faqs.map((f) => (
            <article key={f.id} className="faq-item">
              <div className="faq-main">
                <h3>{f.question}</h3>
                <div className="faq-tags">
                  {f.intent && <span className="tag tag-brand">{f.intent}</span>}
                  {(f.keywords || []).slice(0, 6).map((k) => (
                    <span key={k} className="tag tag-gray">{k}</span>
                  ))}
                </div>
                <p className="faq-answer">{f.answer}</p>
              </div>
              {isAdmin && (
                <div className="faq-actions">
                  <button type="button" className="link-btn" onClick={() => openEdit(f)}>编辑</button>
                  <button type="button" className="link-btn danger" onClick={() => remove(f)}>删除</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {showForm && (
        <div className="modal-mask" onClick={closeForm}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={editing ? '编辑问答' : '新增问答'}>
            <h3>{editing ? '编辑问答' : '新增问答'}</h3>
            {editing && <p className="form-hint mono">id: {editing.id} · 系统生成，不可改</p>}
            <label className="form-field">
              <span>问题</span>
              <input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="访客会怎么问？" />
            </label>
            <label className="form-field">
              <span>意图（可选，用于筛选）</span>
              <input value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value })} placeholder="pricing" />
            </label>
            <label className="form-field">
              <span>回答</span>
              <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={5} placeholder="回复内容…" />
            </label>
            <label className="form-field">
              <span>关键词（逗号/空格分隔，用于模糊匹配）</span>
              <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="收费，报价 价格" />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost-btn" onClick={closeForm}>取消</button>
              <button type="button" className="primary-btn" disabled={saving} onClick={submit}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
