const PHONE = /1[3-9]\d{9}/g;

/** 工具结果里的手机号和门牌只留到可核对的程度。提示词看不到原文。 */
export function maskPhone(value: string): string {
  return value.replace(PHONE, (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`);
}

export function maskAddress(value: string): string {
  const text = value.trim();
  if (text.length <= 6) return '****';
  return `${text.slice(0, 6)}****`;
}

export function redactText(value: string): string {
  return maskPhone(value);
}

export function redactRecord<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && /phone|mobile|电话/.test(key)) next[key] = maskPhone(value);
    else if (typeof value === 'string' && /address|地址/.test(key)) next[key] = maskAddress(value);
    else if (typeof value === 'string') next[key] = maskPhone(value);
    else next[key] = value;
  }
  return next as T;
}
