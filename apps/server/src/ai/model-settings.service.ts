import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { appConfig, AI_PROVIDER_PRESETS } from '../config.js';

/** 一条模型配置：厂商预设 + 可覆盖的接口地址 / 模型 ID / 专属 Key。 */
export interface ModelEntry {
  id: string;
  /** 展示名（工作台列表里看到的名字） */
  name: string;
  /** 厂商预设 key（AI_PROVIDER_PRESETS） */
  provider: string;
  /** 接口地址；空串 = 跟随厂商预设（与环境变量厂商一致时跟随 AI_BASE_URL） */
  baseUrl: string;
  /** 模型 ID，如 deepseek-chat */
  model: string;
  /** 专属 API Key；空串 = 回退环境变量。只写不读，接口永不回传明文 */
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 模型设置文件（data/model-settings.json）v2：模型列表 + 默认模型。 */
export interface ModelSettings {
  version: 2;
  defaultId: string;
  models: ModelEntry[];
}

export interface ModelInput {
  name?: unknown;
  provider?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  apiKey?: unknown;
  /** true 时清空专属 Key，回退环境变量 */
  clearApiKey?: unknown;
  enabled?: unknown;
}

/** 生效中的连接参数（AiService 用）。 */
export interface ActiveConnection {
  id: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

/** 预留的默认模型：首次启动 / 旧格式迁移时保证列表里有一条 DeepSeek。 */
export const RESERVED_DEEPSEEK_ID = 'deepseek';

export class ModelSettingsError extends Error {}

const NAME_MAX = 40;
const MODEL_MAX = 128;
const URL_MAX = 300;
const KEY_MAX = 300;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return 'mdl_' + randomBytes(5).toString('hex');
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function reservedDeepSeek(model?: string): ModelEntry {
  const t = nowIso();
  return {
    id: RESERVED_DEEPSEEK_ID,
    name: 'DeepSeek',
    provider: 'deepseek',
    baseUrl: '',
    model: model || AI_PROVIDER_PRESETS.deepseek.model,
    apiKey: '',
    enabled: true,
    createdAt: t,
    updatedAt: t,
  };
}

/** 环境变量推导的模型（AI_PROVIDER / AI_MODEL），非 DeepSeek 时与预留项并存并作为默认，保持老部署行为。 */
function envEntry(provider: string, model: string): ModelEntry {
  const t = nowIso();
  return {
    id: provider === 'deepseek' ? RESERVED_DEEPSEEK_ID : newId(),
    name: AI_PROVIDER_PRESETS[provider]?.label || provider,
    provider: AI_PROVIDER_PRESETS[provider] ? provider : 'custom',
    baseUrl: '',
    model,
    apiKey: '',
    enabled: true,
    createdAt: t,
    updatedAt: t,
  };
}

/** 无文件或旧格式（v1：defaultProvider/defaultModel/enabled）时的初始列表。 */
function seedSettings(defaultProvider: string, defaultModel: string): ModelSettings {
  if (defaultProvider === 'deepseek' || !AI_PROVIDER_PRESETS[defaultProvider]) {
    const ds = reservedDeepSeek(defaultProvider === 'deepseek' ? defaultModel : undefined);
    return { version: 2, defaultId: ds.id, models: [ds] };
  }
  const env = envEntry(defaultProvider, defaultModel);
  return { version: 2, defaultId: env.id, models: [reservedDeepSeek(), env] };
}

/** 某厂商的 Key 是否已配置（环境变量层面）：优先厂商专属变量，回退 AI_API_KEY；keyOptional 的本地服务视为已配置。 */
export function isProviderKeyConfigured(providerKey: string): boolean {
  const preset = AI_PROVIDER_PRESETS[providerKey];
  if (!preset) return false;
  if (preset.keyOptional) return true;
  const vendorVar = `${providerKey.toUpperCase()}_API_KEY`;
  return Boolean(process.env[vendorVar] || process.env.AI_API_KEY);
}

/** 环境变量里该厂商可用的 Key（厂商专属变量优先，再回退全局 AI Key）。 */
function envKeyFor(provider: string): string {
  const vendorVar = `${provider.toUpperCase()}_API_KEY`;
  return process.env[vendorVar] || appConfig.aiApiKey || '';
}

/** Key 来源：custom=本条专属；env=环境变量；optional=本地服务无需 Key；none=未配置 */
export function keySourceOf(entry: ModelEntry): 'custom' | 'env' | 'optional' | 'none' {
  if (entry.apiKey) return 'custom';
  if (AI_PROVIDER_PRESETS[entry.provider]?.keyOptional) return 'optional';
  return isProviderKeyConfigured(entry.provider) ? 'env' : 'none';
}

/** 脱敏展示：只露末 4 位 */
export function maskKey(key: string): string | null {
  if (!key) return null;
  return '••••' + key.slice(-4);
}

/**
 * 模型设置服务：工作台增删改查模型配置，写文件 + 热更新，AiService 实时跟随默认模型。
 * 约束：至少保留一个模型；默认模型不可删除、不可停用。
 */
@Injectable()
export class ModelSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelSettingsService.name);
  private settings: ModelSettings = seedSettings(appConfig.aiProvider, appConfig.aiModel);
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

  /** 文件缺失 → 预置 DeepSeek（+ 环境变量模型）；旧格式 → 迁移；损坏 → 告警后用预置值，不阻断启动。 */
  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.settings = this.sanitize(JSON.parse(raw));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`model-settings.json 读取失败，使用预置模型：${e?.message || e}`);
      }
      this.settings = seedSettings(appConfig.aiProvider, appConfig.aiModel);
    }
  }

  private sanitize(input: any): ModelSettings {
    // 旧格式 v1：{ defaultProvider, defaultModel, enabled } → 迁移为列表
    if (!Array.isArray(input?.models)) {
      const provider = typeof input?.defaultProvider === 'string' ? input.defaultProvider : appConfig.aiProvider;
      const model = str(input?.defaultModel) || appConfig.aiModel;
      return seedSettings(provider, model.slice(0, MODEL_MAX));
    }
    const seen = new Set<string>();
    const models: ModelEntry[] = [];
    for (const m of input.models) {
      const id = str(m?.id);
      const provider = str(m?.provider);
      const model = str(m?.model);
      if (!id || seen.has(id) || !AI_PROVIDER_PRESETS[provider] || !model) continue;
      seen.add(id);
      models.push({
        id,
        name: str(m?.name).slice(0, NAME_MAX) || AI_PROVIDER_PRESETS[provider].label,
        provider,
        baseUrl: str(m?.baseUrl).slice(0, URL_MAX),
        model: model.slice(0, MODEL_MAX),
        apiKey: str(m?.apiKey).slice(0, KEY_MAX),
        enabled: m?.enabled !== false,
        createdAt: str(m?.createdAt) || nowIso(),
        updatedAt: str(m?.updatedAt) || nowIso(),
      });
    }
    if (!models.length) return seedSettings(appConfig.aiProvider, appConfig.aiModel);
    let def = models.find((m) => m.id === str(input?.defaultId));
    if (!def) def = models.find((m) => m.enabled) || models[0];
    // 默认模型必须启用
    def.enabled = true;
    return { version: 2, defaultId: def.id, models };
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
      // 文件不存在时 watch 会抛错；之后由写操作直接更新内存
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.settings, null, 2) + '\n', 'utf8');
  }

  // ---------- 读 ----------

  getSettings(): ModelSettings {
    return { ...this.settings, models: this.settings.models.map((m) => ({ ...m })) };
  }

  listModels(): ModelEntry[] {
    return this.settings.models.map((m) => ({ ...m }));
  }

  getDefaultId(): string {
    return this.settings.defaultId;
  }

  private defaultEntry(): ModelEntry {
    return this.settings.models.find((m) => m.id === this.settings.defaultId) || this.settings.models[0];
  }

  getActiveProvider(): string {
    return this.defaultEntry().provider;
  }

  getActiveModel(): string {
    return this.defaultEntry().model;
  }

  /** 模型是否存在且启用（租户指定模型时校验用） */
  isUsable(id: string): boolean {
    return this.settings.models.some((m) => m.id === id && m.enabled);
  }

  hasModel(id: string): boolean {
    return this.settings.models.some((m) => m.id === id);
  }

  /** 默认模型的连接参数 */
  getActiveConnection(): ActiveConnection {
    return this.getConnectionFor(null);
  }

  /**
   * 指定模型的连接参数（租户专属模型）；模型不存在或已停用时回退默认模型，保证回复不中断。
   * 接口地址 / Key 留空时回退厂商预设与环境变量。
   */
  getConnectionFor(id?: string | null): ActiveConnection {
    const picked = id ? this.settings.models.find((m) => m.id === id && m.enabled) : undefined;
    const e = picked || this.defaultEntry();
    const preset = AI_PROVIDER_PRESETS[e.provider];
    const baseUrl =
      e.baseUrl || (e.provider === appConfig.aiProvider ? appConfig.aiBaseUrl : '') || preset?.baseUrl || '';
    const apiKey = e.apiKey || envKeyFor(e.provider) || (preset?.keyOptional ? 'local' : '');
    return { id: e.id, provider: e.provider, model: e.model, baseUrl, apiKey };
  }

  // ---------- 写 ----------

  private find(id: string): ModelEntry {
    const m = this.settings.models.find((x) => x.id === id);
    if (!m) throw new ModelSettingsError('模型不存在');
    return m;
  }

  /** 校验并合并字段；create 时 provider/model 必填，其余字段按预设补齐。 */
  private applyInput(target: ModelEntry, input: ModelInput, creating: boolean): void {
    if (input.provider !== undefined || creating) {
      const p = str(input.provider);
      if (!AI_PROVIDER_PRESETS[p]) throw new ModelSettingsError(`未知的厂商：${p || '（空）'}`);
      target.provider = p;
    }
    if (input.model !== undefined || creating) {
      const m = str(input.model) || (creating ? AI_PROVIDER_PRESETS[target.provider].model : '');
      if (!m) throw new ModelSettingsError('模型 ID 不能为空');
      if (m.length > MODEL_MAX) throw new ModelSettingsError('模型 ID 过长');
      target.model = m;
    }
    if (input.name !== undefined || creating) {
      const n = str(input.name) || AI_PROVIDER_PRESETS[target.provider].label;
      if (n.length > NAME_MAX) throw new ModelSettingsError(`名称不能超过 ${NAME_MAX} 个字`);
      target.name = n;
    }
    if (input.baseUrl !== undefined) {
      const u = str(input.baseUrl);
      if (u) {
        if (u.length > URL_MAX) throw new ModelSettingsError('接口地址过长');
        let parsed: URL;
        try { parsed = new URL(u); } catch { throw new ModelSettingsError('接口地址格式不正确'); }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new ModelSettingsError('接口地址只支持 http / https');
        }
      }
      target.baseUrl = u;
    }
    // 自定义厂商没有预设地址，必须自己填
    if (target.provider === 'custom' && !target.baseUrl) {
      throw new ModelSettingsError('自定义厂商需要填写接口地址');
    }
    if (input.clearApiKey === true) {
      target.apiKey = '';
    } else if (input.apiKey !== undefined) {
      const k = str(input.apiKey);
      if (k.length > KEY_MAX) throw new ModelSettingsError('API Key 过长');
      // 空串表示「不修改」：编辑时 Key 输入框默认为空，避免误清掉已有 Key
      if (k) target.apiKey = k;
    }
    if (input.enabled !== undefined) {
      target.enabled = Boolean(input.enabled);
    }
  }

  async createModel(input: ModelInput): Promise<ModelEntry> {
    const t = nowIso();
    const entry: ModelEntry = {
      id: newId(), name: '', provider: '', baseUrl: '', model: '', apiKey: '',
      enabled: true, createdAt: t, updatedAt: t,
    };
    this.applyInput(entry, input, true);
    this.settings.models.push(entry);
    await this.persist();
    return { ...entry };
  }

  async updateModel(id: string, input: ModelInput): Promise<ModelEntry> {
    const current = this.find(id);
    const next = { ...current };
    this.applyInput(next, input, false);
    if (id === this.settings.defaultId && !next.enabled) {
      throw new ModelSettingsError('默认模型不能停用，请先将其他模型设为默认');
    }
    next.updatedAt = nowIso();
    Object.assign(current, next);
    await this.persist();
    return { ...current };
  }

  async deleteModel(id: string): Promise<void> {
    this.find(id);
    if (this.settings.models.length <= 1) {
      throw new ModelSettingsError('至少需要保留一个模型，无法删除');
    }
    if (id === this.settings.defaultId) {
      throw new ModelSettingsError('默认模型不能删除，请先将其他模型设为默认');
    }
    this.settings.models = this.settings.models.filter((m) => m.id !== id);
    await this.persist();
  }

  async setDefault(id: string): Promise<ModelEntry> {
    const m = this.find(id);
    if (!m.enabled) throw new ModelSettingsError('请先启用该模型，再设为默认');
    this.settings.defaultId = id;
    await this.persist();
    return { ...m };
  }
}
