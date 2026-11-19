import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AgentActionCard } from '@assistflow/shared';
import type { ToolArgs } from './schema.js';

export interface PendingToolAction extends AgentActionCard {
  sessionId: string;
  args: ToolArgs;
}

@Injectable()
export class AgentActionService {
  private readonly actions = new Map<string, PendingToolAction>();

  create(input: Omit<PendingToolAction, 'id' | 'status'>): PendingToolAction {
    const action: PendingToolAction = { ...input, id: randomUUID(), status: 'pending' };
    this.actions.set(action.id, action);
    return action;
  }

  get(id: string): PendingToolAction | undefined {
    return this.actions.get(id);
  }

  mark(id: string, status: PendingToolAction['status']): PendingToolAction | undefined {
    const action = this.actions.get(id);
    if (!action) return undefined;
    action.status = status;
    return action;
  }
}
