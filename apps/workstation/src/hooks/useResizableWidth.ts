import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** localStorage 键：宽度按浏览器记住 */
  storageKey: string;
  /** 默认宽度：数字为固定像素；函数则按当前窗口计算（未自定义时随窗口变化） */
  defaultWidth: number | (() => number);
  min: number;
  /** 绝对上限（可选）；不传则只受窗口比例限制 */
  max?: number;
  /** 最多占窗口宽度的比例，防止把主区域挤没 */
  maxViewportRatio?: number;
}

function readStored(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: number | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // 隐私模式等禁用存储时忽略：只是不记住宽度
  }
}

/**
 * 可拖拽调整的宽度：返回当前宽度与分隔条的事件处理。
 * 拖拽中实时更新、松手后写入 localStorage；双击恢复默认；方向键微调（键盘可达）。
 * 未自定义（无存储值）时宽度跟随默认值，窗口缩放会重新计算；拖过之后固定为用户的宽度。
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max = Infinity, maxViewportRatio = 0.4 }: Options) {
  // 当前允许的最大宽度：随窗口大小变化
  const upperBound = useCallback(
    () => Math.max(min, Math.min(max, Math.floor(window.innerWidth * maxViewportRatio))),
    [min, max, maxViewportRatio],
  );
  const clamp = useCallback(
    (w: number) => Math.round(Math.min(upperBound(), Math.max(min, w))),
    [min, upperBound],
  );
  const [upper, setUpper] = useState(upperBound);
  const getDefault = useCallback(
    () => (typeof defaultWidth === 'function' ? defaultWidth() : defaultWidth),
    [defaultWidth],
  );
  // 是否用户自定义过宽度：决定窗口缩放时是跟随默认值，还是保持用户宽度
  const custom = useRef(readStored(storageKey) !== null);

  const [width, setWidth] = useState(() => clamp(readStored(storageKey) ?? getDefault()));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  // 窗口变化时更新上限，并把宽度收回到允许范围内
  useEffect(() => {
    const onResize = () => {
      setUpper(upperBound());
      setWidth((w) => clamp(custom.current ? w : getDefault()));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp, upperBound, getDefault]);

  // 拖拽期间全局禁止选中文字、统一光标
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('is-col-resizing');
    return () => document.body.classList.remove('is-col-resizing');
  }, [dragging]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: widthRef.current };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    setWidth(clamp(drag.current.startW + e.clientX - drag.current.startX));
  }, [clamp]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    custom.current = true;
    writeStored(storageKey, widthRef.current);
  }, [storageKey]);

  const reset = useCallback(() => {
    custom.current = false;
    setWidth(clamp(getDefault()));
    writeStored(storageKey, null);
  }, [clamp, getDefault, storageKey]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = widthRef.current - step;
    else if (e.key === 'ArrowRight') next = widthRef.current + step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = upperBound();
    if (next === null) return;
    e.preventDefault();
    const w = clamp(next);
    custom.current = true;
    setWidth(w);
    writeStored(storageKey, w);
  }, [clamp, min, upperBound, storageKey]);

  return {
    width,
    dragging,
    min,
    /** 当前允许的最大宽度（窗口宽度 × 比例） */
    max: upper,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: reset,
      onKeyDown,
    },
  };
}
