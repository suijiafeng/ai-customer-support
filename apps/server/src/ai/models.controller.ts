import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException,
  Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { AI_PROVIDER_PRESETS } from '../config.js';
import {
  ModelSettingsError, ModelSettingsService, keySourceOf, maskKey, type ModelEntry,
} from './model-settings.service.js';

/** 模型管理（工作台「模型管理」页）：模型配置增删改查 + 设为默认。仅 admin。 */
@UseGuards(AgentAuthGuard)
@Controller('api/admin/models')
export class ModelsController {
  constructor(private readonly modelSettings: ModelSettingsService) {}

  private assertAdmin(req: any): AuthenticatedAgent {
    const agent = req.agent as AuthenticatedAgent;
    if (agent.role !== 'admin') {
      throw new ForbiddenException({ error: 'admin only' });
    }
    return agent;
  }

  /** 对外视图：Key 只回传来源与末 4 位，永不回传明文。 */
  private view(m: ModelEntry) {
    const preset = AI_PROVIDER_PRESETS[m.provider];
    return {
      id: m.id,
      name: m.name,
      provider: m.provider,
      providerLabel: preset?.label || m.provider,
      baseUrl: m.baseUrl,
      presetBaseUrl: preset?.baseUrl || '',
      model: m.model,
      enabled: m.enabled,
      isDefault: m.id === this.modelSettings.getDefaultId(),
      keySource: keySourceOf(m),
      keyMasked: maskKey(m.apiKey),
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  private fail(e: any): never {
    if (e instanceof ModelSettingsError) {
      if (e.message === '模型不存在') throw new NotFoundException({ error: e.message });
      throw new BadRequestException({ error: e.message });
    }
    throw e;
  }

  @Get()
  list(@Req() req: any) {
    this.assertAdmin(req);
    return {
      defaultId: this.modelSettings.getDefaultId(),
      models: this.modelSettings.listModels().map((m) => this.view(m)),
      providers: Object.entries(AI_PROVIDER_PRESETS).map(([key, p]) => ({
        key,
        label: p.label,
        baseUrl: p.baseUrl,
        model: p.model,
        keyOptional: Boolean(p.keyOptional),
      })),
    };
  }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    this.assertAdmin(req);
    try {
      return { model: this.view(await this.modelSettings.createModel(body || {})) };
    } catch (e) {
      this.fail(e);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    this.assertAdmin(req);
    try {
      return { model: this.view(await this.modelSettings.updateModel(id, body || {})) };
    } catch (e) {
      this.fail(e);
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    this.assertAdmin(req);
    try {
      await this.modelSettings.deleteModel(id);
      return { ok: true };
    } catch (e) {
      this.fail(e);
    }
  }

  @Post(':id/default')
  async setDefault(@Param('id') id: string, @Req() req: any) {
    this.assertAdmin(req);
    try {
      return { model: this.view(await this.modelSettings.setDefault(id)) };
    } catch (e) {
      this.fail(e);
    }
  }
}
