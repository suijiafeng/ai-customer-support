import React, { useEffect, useRef, useState } from 'react';

// 轻量应用内反馈：toast 提示 + confirm 对话框，替代原生 window.alert/confirm。
// 用模块级订阅，组件外（如 catch 块）也能直接调用 showToast / confirmDialog。

type ToastKind = 'info' | 'success' | 'warning' | 'error';
interface ToastItem { id: number; text: string; kind: ToastKind; count: number; }
interface ConfirmReq {
  id: number;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: (ok: boolean) => void;
}

let toastSeq = 0;
let confirmSeq = 0;
const toastSubs = new Set<(items: ToastItem[]) => void>();
const confirmSubs = new Set<(req: ConfirmReq | null) => void>();
let toasts: ToastItem[] = [];
let activeConfirm: ConfirmReq | null = null;

function emitToasts() { toastSubs.forEach((fn) => fn(toasts)); }
function emitConfirm() { confirmSubs.forEach((fn) => fn(activeConfirm)); }

/** 同时最多显示的 toast 数：再多就挤掉最早的一条，避免连点时整列堆叠遮住内容 */
const MAX_TOASTS = 2;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

function dismissToast(id: number) {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

function armToast(id: number, durationMs: number) {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.set(id, setTimeout(() => dismissToast(id), durationMs));
}

export function showToast(text: string, kind: ToastKind = 'info', durationMs = 3000) {
  // 相同内容的提示合并成一条（显示 ×N），并重新计时，而不是再叠一条
  const same = toasts.find((t) => t.text === text && t.kind === kind);
  if (same) {
    toasts = toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t));
    armToast(same.id, durationMs);
    emitToasts();
    return;
  }
  const item: ToastItem = { id: ++toastSeq, text, kind, count: 1 };
  toasts = [...toasts, item];
  while (toasts.length > MAX_TOASTS) dismissToast(toasts[0].id);
  armToast(item.id, durationMs);
  emitToasts();
}

export function confirmDialog(
  message: string,
  opts: { confirmText?: string; cancelText?: string } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    // 同一时刻只保留一个对话框：若已有，先取消旧的
    if (activeConfirm) activeConfirm.resolve(false);
    activeConfirm = {
      id: ++confirmSeq,
      message,
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '取消',
      resolve,
    };
    emitConfirm();
  });
}

/** 挂在 App 根部一次，渲染 toast 与 confirm 弹层。 */
export function FeedbackHost() {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(activeConfirm);

  useEffect(() => {
    toastSubs.add(setItems);
    confirmSubs.add(setConfirm);
    return () => { toastSubs.delete(setItems); confirmSubs.delete(setConfirm); };
  }, []);

  const close = (ok: boolean) => {
    if (!confirm) return;
    confirm.resolve(ok);
    activeConfirm = null;
    emitConfirm();
  };

  // 对话框打开时：Esc = 取消；焦点放到「取消」上（误按回车不会执行危险操作），关闭后还给原来的元素
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!confirm) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 捕获阶段拦下，避免同一下 Esc 又关掉背后的详情栏/菜单
      e.stopPropagation();
      e.preventDefault();
      closeRef.current(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [confirm]);

  return (
    <>
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
            {t.count > 1 && <span className="toast-count" aria-label={`第 ${t.count} 次`}>×{t.count}</span>}
          </div>
        ))}
      </div>
      {confirm && (
        <div className="dialog-overlay" onClick={() => close(false)}>
          <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className="dialog-msg">{confirm.message}</p>
            <div className="dialog-actions">
              <button ref={cancelRef} className="dialog-cancel" onClick={() => close(false)}>{confirm.cancelText}</button>
              <button className="dialog-confirm" onClick={() => close(true)}>{confirm.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
