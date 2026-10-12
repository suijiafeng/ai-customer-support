import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedAgent } from '../auth/auth.service.js';
import { AI_PROVIDER_PRESETS } from '../config.js';
import { ModelSettingsService, isProviderKeyConfigured } from './model-settings.service.js';

/** 模型管理（工作台「模型管理」页）：查看厂商/启用状态/默认模型，运营可切换。仅 admin。 */
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

  @Get()
  list(@Req() req: any) {
    this.assertAdmin(req);
    const settings = this.modelSettings.getSettings();
    const vendors = Object.entries(AI_PROVIDER_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      baseUrl: preset.baseUrl,
      defaultModel: preset.model,
      keyConfigured: isProviderKeyConfigured(key),
      enabled: this.modelSettings.isEnabled(key),
    }));
    return {
      active: {
        provider: this.modelSettings.getActiveProvider(),
        model: this.modelSettings.getActiveModel(),
      },
      vendors,
    };
  }

  @Patch()
  async update(@Body() body: any, @Req() req: any) {
    this.assertAdmin(req);
    try {
      const settings = await this.modelSettings.updateSettings(body);
      return { settings };
    } catch (e: any) {
      throw new BadRequestException({ error: e?.message || 'invalid model settings' });
    }
  }
}
