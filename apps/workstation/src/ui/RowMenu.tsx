import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * 表格行的「更多」下拉。弹层通过 portal 挂到 body、fixed 定位在按钮下方：操作列是 sticky 单元格，
 * 自成层叠上下文，弹层留在单元格里会被下一行盖住，也会被横向滚动容器裁掉。
 * 键盘：Enter/空格/↓ 打开并聚焦第一项，↑↓ 在项间移动，Home/End 首尾，Esc 关闭并把焦点还给按钮，
 * Tab 离开时关闭。
 */
export default function RowMenu({ items, label = '更多操作' }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const focusIndex = useRef(0);

  const enabled = items.filter((i) => !i.disabled);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  const focusItem = (index: number) => {
    const nodes = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    if (!nodes?.length) return;
    const next = (index + nodes.length) % nodes.length;
    focusIndex.current = next;
    nodes[next].focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusItem(focusIndex.current));
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    // 页面或表格滚动时弹层位置会错开，直接收起
    const onScroll = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(focusIndex.current + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(focusIndex.current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Tab') close(false);
  };

  const onBtnKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusIndex.current = e.key === 'ArrowUp' ? -1 : 0;
      setOpen(true);
    }
  };

  if (!enabled.length) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="ghost-btn row-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => { focusIndex.current = 0; setOpen((v) => !v); }}
        onKeyDown={onBtnKey}
      >
        更多<span className="row-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="row-menu"
          role="menu"
          aria-label={label}
          style={{ top: pos.top, right: pos.right }}
          onKeyDown={onMenuKey}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => { close(); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
