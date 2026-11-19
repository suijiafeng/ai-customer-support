import type { ToolSchema, ToolArgs } from './schema.js';
import { validateArgs } from './schema.js';

export type ToolPermission = 'read' | 'confirm';

export interface ToolContext {
  sessionId: string;
  tenantKey: string | null;
  message: string;
}

export interface ToolOutcome {
  ok: boolean;
  status: 'ok' | 'denied' | 'invalid' | 'error' | 'pending' | 'disabled';
  summary: string;
  data: unknown;
  demo: boolean;
  handoff?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: ToolSchema;
  permission: ToolPermission;
  execute(args: ToolArgs, ctx: ToolContext): Promise<ToolOutcome>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  /** 缺省表示该租户启用全部工具。显式 false 才关掉。 */
  private readonly tenantFlags = new Map<string, Record<string, boolean>>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  setTenantTools(tenantKey: string, flags: Record<string, boolean>): void {
    this.tenantFlags.set(tenantKey, { ...flags });
  }

  enabled(tenantKey: string | null, name: string): boolean {
    if (!tenantKey) return true;
    const flags = this.tenantFlags.get(tenantKey);
    if (!flags || !(name in flags)) return true;
    return flags[name] !== false;
  }

  checkArgs(tool: AgentTool, args: unknown) {
    return validateArgs(tool.parameters, args);
  }
}
