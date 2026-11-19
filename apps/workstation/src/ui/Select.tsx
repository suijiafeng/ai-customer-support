import React, { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** 受控下拉，替代浏览器原生 select，和表单输入框同一套边框与圆角。 */
export default function Select({
  id,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const autoId = useId();
  const listId = `${id || autoId}-list`;
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  };

  return (
    <div className={`af-select${open ? ' open' : ''}`} ref={root}>
      <button
        type="button"
        id={id}
        ref={btnRef}
        className="af-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) setOpen(false);
          else { place(); setOpen(true); }
        }}
      >
        <span className="af-select-label">{current?.label || '请选择'}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && box && (
        <ul className="af-select-menu" id={listId} role="listbox" style={{ top: box.top, left: box.left, width: box.width }}>
          {options.map((option) => (
            <li key={option.value || option.label}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={option.value === value ? 'active' : ''}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
