/** 工具入参只接受这份子集：对象、必填、字符串/数字/布尔、枚举和最大长度。 */

export interface SchemaField {
  type: 'string' | 'number' | 'boolean';
  description?: string;
  enum?: string[];
  maxLength?: number;
}

export interface ToolSchema {
  type: 'object';
  properties: Record<string, SchemaField>;
  required?: string[];
  additionalProperties: false;
}

export type ToolArgs = Record<string, string | number | boolean>;

export function validateArgs(
  schema: ToolSchema,
  value: unknown,
): { ok: true; data: ToolArgs } | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '参数必须是对象' };
  }
  const source = value as Record<string, unknown>;
  const data: ToolArgs = {};
  for (const key of schema.required || []) {
    if (source[key] === undefined || source[key] === '') {
      return { ok: false, error: `缺少参数 ${key}` };
    }
  }
  for (const [key, raw] of Object.entries(source)) {
    const field = schema.properties[key];
    if (!field) {
      if (schema.additionalProperties === false) return { ok: false, error: `不能传 ${key}` };
      continue;
    }
    if (typeof raw !== field.type) return { ok: false, error: `${key} 必须是 ${field.type}` };
    if (field.enum && !field.enum.includes(String(raw))) return { ok: false, error: `${key} 不在允许范围内` };
    if (field.type === 'string' && field.maxLength && String(raw).length > field.maxLength) {
      return { ok: false, error: `${key} 超过 ${field.maxLength} 字` };
    }
    data[key] = raw as string | number | boolean;
  }
  return { ok: true, data };
}
