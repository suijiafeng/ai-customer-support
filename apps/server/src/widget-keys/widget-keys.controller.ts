import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { WidgetKeysService } from './widget-keys.service.js';
import { ModelSettingsService } from '../ai/model-settings.service.js';

/** 租户管理（原 Widget 接入密钥）：仅 admin 可创建/启停/删除。 */
@UseGuards(AgentAuthGuard)
@Controller('api/widget-keys')
export class WidgetKeysController {
  constructor(
    private readonly widgetKeys: WidgetKeysService,
    private readonly modelSettings: ModelSettingsService,
  ) {}

  /** 租户指定模型：空 = 跟随默认；非空必须是模型管理里存在且启用的模型 */
  private checkModelId(raw: unknown): string | null {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id) return null;
    if (!this.modelSettings.hasModel(id)) throw new BadRequestException({ error: '所选模型不存在，请刷新后重试' });
    if (!this.modelSettings.isUsable(id)) throw new BadRequestException({ error: '所选模型已停用，请先在模型管理中启用' });
    return id;
  }

  private assertAdmin(agent: AuthenticatedAgent) {
    if (agent.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin only' });
    }
  }

  @Get()
  list(@Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { keys: this.widgetKeys.list() };
  }

  @Post()
  create(@Body() body: any, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    const modelId = this.checkModelId(body?.modelId);
    return { key: this.widgetKeys.create(body?.name, body?.key, body?.remark, body?.domain, modelId) };
  }

  @Patch(':key')
  update(@Param('key') key: string, @Body() body: any, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    const patch: { name?: string; domain?: string; remark?: string; active?: boolean; modelId?: string | null } = {};
    if (body?.name !== undefined) patch.name = body.name;
    if (body?.domain !== undefined) patch.domain = body.domain;
    if (body?.remark !== undefined) patch.remark = body.remark;
    if (body?.active !== undefined) patch.active = Boolean(body.active);
    if (body?.modelId !== undefined) patch.modelId = this.checkModelId(body.modelId);
    return { key: this.widgetKeys.update(key, patch) };
  }

  @Get(':key/stats')
  stats(@Param('key') key: string, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    return { stats: this.widgetKeys.getStats(key) };
  }

  @Delete(':key')
  remove(@Param('key') key: string, @Req() req: any) {
    this.assertAdmin(req.agent as AuthenticatedAgent);
    this.widgetKeys.remove(key);
    return { ok: true };
  }
}
