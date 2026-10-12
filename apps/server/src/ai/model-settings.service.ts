import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { appConfig, AI_PROVIDER_PRESETS } from '../config.js';

/** 模型运营设置（data/model-settings.json）：默认厂商/模型 + 各厂商启用开关。 */
export interface ModelSettings {
  defaultProvider: string;
  defaultModel: string;
  /** 缺省 key 视为启用；false 为手动关闭。 */
  enabled: Record<string, boolean>;
}

/**
 * 模型设置服务：文件缺失时回退到环境变量推导值（行为与原来一致），
 * 工作台修改后写文件 + 热更新，AiService 实时跟随。
 */
@Injectable()
export class ModelSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelSettingsService.name);
  private settings: ModelSettings = {
    defaultProvider: appConfig.aiProvider,
    defaultModel: appConfig.aiModel,
    enabled: {},
  };
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /** 调用时读取，测试可用进程环境变量指向临时目录（构造器保持无参）。 */
  private get dataDir(): string {
    return process.env.DATA_DIR || appConfig.dataDir;
  }

  private get filePath(): string {
    return path.join(this.dataDir, 'model-settings.json');
  }

  async onModuleInit() {
    await this.load();
    this.watchFile();
  }

  onModuleDestroy() {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** 文件缺失/损坏时回退 env 推导值并告警，不阻断启动。 */
  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.settings = this.sanitize(parsed);
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`model-settings.json 读取失败，使用环境变量默认值：${e?.message || e}`);
      }
      this.settings = {
        defaultProvider: appConfig.aiProvider,
        defaultModel: appConfig.aiModel,
        enabled: {},
      };
    }
  }

  private sanitize(input: any): ModelSettings {
    const provider =
      typeof input?.defaultProvider === 'string' && AI_PROVIDER_PRESETS[input.defaultProvider]
        ? input.defaultProvider
        : appConfig.aiProvider;
    const model =
      typeof input?.defaultModel === 'string' && input.defaultModel.trim()
        ? input.defaultModel.trim().slice(0, 128)
        : appConfig.aiModel;
    const enabled: Record<string, boolean> = {};
    if (input?.enabled && typeof input.enabled === 'object') {
      for (const [k, v] of Object.entries(input.enabled)) {
        if (AI_PROVIDER_PRESETS[k]) enabled[k] = Boolean(v);
      }
    }
    return { defaultProvider: provider, defaultModel: model, enabled };
  }

  private watchFile(): void {
    try {
      this.watcher = watch(this.filePath, () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(async () => {
          this.logger.log('model-settings.json 变更，重新加载…');
          await this.load();
        }, 500);
      });
    } catch {
      // 文件不存在时 watch 会抛错；下次写入后由 updateSettings 直接更新内存
    }
  }

  getSettings(): ModelSettings {
    return { ...this.settings, enabled: { ...this.settings.enabled } };
  }

  getActiveProvider(): string {
    return this.settings.defaultProvider;
  }

  getActiveModel(): string {
    return this.settings.defaultModel;
  }

  isEnabled(providerKey: string): boolean {
    return this.settings.enabled[providerKey] !== false;
  }

  /** 运营修改：校验后写文件并立即生效。 */
  async updateSettings(patch: any): Promise<ModelSettings> {
    const next: any = { ...this.settings };
    if (patch?.defaultProvider !== undefined) {
      const p = String(patch.defaultProvider);
      if (!AI_PROVIDER_PRESETS[p]) throw new Error(`未知的厂商：${p}`);
      next.defaultProvider = p;
      // 换厂商时若未显式指定模型，跟随该厂商预设默认模型
      if (patch?.defaultModel === undefined) {
        next.defaultModel = AI_PROVIDER_PRESETS[p].model;
      }
    }
    if (patch?.defaultModel !== undefined) {
      const m = String(patch.defaultModel).trim();
      if (!m) throw new Error('defaultModel 不能为空');
      if (m.length > 128) throw new Error('defaultModel 过长');
      next.defaultModel = m;
    }
    if (patch?.enabled !== undefined) {
      if (typeof patch.enabled !== 'object' || patch.enabled === null || Array.isArray(patch.enabled)) {
        throw new Error('enabled 必须是对象');
      }
      const enabled: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(patch.enabled)) {
        if (!AI_PROVIDER_PRESETS[k]) throw new Error(`未知的厂商：${k}`);
        enabled[k] = Boolean(v);
      }
      next.enabled = enabled;
    }
    this.settings = this.sanitize(next);
    await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2) + '\n', 'utf8');
    return this.getSettings();
  }
}

/** 某厂商的 Key 是否已配置：优先厂商专属变量，回退 AI_API_KEY；keyOptional 的本地服务视为已配置。 */
export function isProviderKeyConfigured(providerKey: string): boolean {
  const preset = AI_PROVIDER_PRESETS[providerKey];
  if (!preset) return false;
  if (preset.keyOptional) return true;
  const vendorVar = `${providerKey.toUpperCase()}_API_KEY`;
  return Boolean(process.env[vendorVar] || process.env.AI_API_KEY);
}
