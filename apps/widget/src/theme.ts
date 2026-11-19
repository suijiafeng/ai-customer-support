// 主题色：校验 data-theme 传入的十六进制色值，派生 CSS 变量
export interface ThemeVars {
  brand: string;
  brandRgb: string;
  brandSoft: string;
}

const DEFAULT_THEME: ThemeVars = {
  brand: '#2457c5',
  brandRgb: '36, 87, 197',
  brandSoft: '#eef2fb',
};

// 接受 #rgb / #rrggbb，非法时返回 null
function parseHex(input: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 浅色底：品牌色与白色按 12% / 88% 混合
function mixWhite([r, g, b]: [number, number, number], ratio = 0.88): string {
  const c = (v: number) => Math.round(v + (255 - v) * ratio);
  return '#' + [c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function resolveTheme(input?: string | null): ThemeVars {
  if (!input) return DEFAULT_THEME;
  const rgb = parseHex(input);
  if (!rgb) {
    console.warn('[AssistFlow] 无效的 data-theme 色值，已使用默认主题:', input);
    return DEFAULT_THEME;
  }
  const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { brand: hex, brandRgb: rgb.join(', '), brandSoft: mixWhite(rgb) };
}
