import React from 'react';

type Illustration = 'chat' | 'ticket' | 'book' | 'search';

// 线性插画：统一 96×96 画布、1.5 描边、中性灰，强调色只点缀一处
const ART: Record<Illustration, React.ReactNode> = {
  // 会话为空：对话框 + 三个省略点
  chat: (
    <>
      <rect x="14" y="20" width="60" height="42" rx="10" />
      <path d="M28 62 L24 76 L40 62" />
      <circle cx="34" cy="41" r="2.5" className="es-accent" />
      <circle cx="44" cy="41" r="2.5" className="es-accent" />
      <circle cx="54" cy="41" r="2.5" className="es-accent" />
      <path d="M78 34 h6 M81 31 v6" />
    </>
  ),
  // 工单为空：剪贴板 + 对勾
  ticket: (
    <>
      <rect x="24" y="18" width="48" height="62" rx="6" />
      <rect x="36" y="13" width="24" height="10" rx="3" />
      <path d="M36 50 l8 8 l16 -18" className="es-accent" />
      <path d="M34 70 h28" />
    </>
  ),
  // 知识库为空：摊开的书
  book: (
    <>
      <path d="M48 26 C40 20 26 20 16 23 V74 C26 71 40 71 48 77 C56 71 70 71 80 74 V23 C70 20 56 20 48 26 Z" />
      <path d="M48 26 V77" />
      <path d="M24 36 h16 M24 46 h16 M24 56 h12" />
      <path d="M56 36 h16 M56 46 h16" className="es-accent" />
    </>
  ),
  // 搜索无结果：放大镜 + 斜杠
  search: (
    <>
      <circle cx="42" cy="42" r="20" />
      <path d="M57 57 L76 76" />
      <path d="M34 42 h16" className="es-accent" />
    </>
  ),
};

interface EmptyStateProps {
  icon: Illustration;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  /** 紧凑尺寸：用于卡片 / 表格内部 */
  compact?: boolean;
}

/** 空状态：线性插画 + 一句说明 + 一个可选动作（设计稿 09 页） */
export default function EmptyState({ icon, title, hint, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <svg className="es-art" viewBox="0 0 96 96" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ART[icon]}
      </svg>
      <p className="es-title">{title}</p>
      {hint && <p className="es-hint">{hint}</p>}
      {action && (
        <button type="button" className="es-action" onClick={action.onClick}>{action.label}</button>
      )}
    </div>
  );
}
