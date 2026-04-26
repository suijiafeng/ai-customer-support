var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AiProvidersService_1;
import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, } from '@nestjs/common';
import OpenAI from 'openai';
import { AI_PROVIDER_CATALOG, MAX_CUSTOM_AI_PROVIDERS, } from '@assistflow/shared';
import { StoreService } from '../store/store.service.js';
import { resolveAuthSecret } from '../auth/auth.service.js';
import { openSecret, sealSecret } from './secret-box.js';
const MAX_NAME_LENGTH = 40;
const MAX_BASE_URL_LENGTH = 200;
const MAX_MODEL_ID_LENGTH = 120;
const MAX_ENABLED_MODELS = 50;
const MAX_CONTEXT_BUDGET = 10_000_000;
/** 测试连接 / 拉模型列表的超时（毫秒） */
const TEST_TIMEOUT_MS = 15_000;
/** 拉模型列表的数量上限（OpenRouter 等平台有上千个模型） */
const MAX_LISTED_MODELS = 2000;
const CATALOG_BY_ID = new Map(AI_PROVIDER_CATALOG.map((e) => [e.id, e]));
function maskKey(key) {
    if (key.length <= 8)
        return `${key.slice(0, 2)}•••••`;
    return `${key.slice(0, 4)}•••••${key.slice(-4)}`;
}
function normalizeBaseUrl(raw) {
    const value = String(raw ?? '').trim().slice(0, MAX_BASE_URL_LENGTH).replace(/\/+$/, '');
    if (!value)
        return '';
    if (!/^https?:\/\//i.test(value))
        throw new BadRequestException({ error: 'baseUrl must start with http(s)://' });
    return value;
}
function normalizeModels(raw) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        throw new BadRequestException({ error: 'enabledModels must be an array' });
    const seen = new Set();
    for (const item of raw) {
        const model = String(item ?? '').trim().slice(0, MAX_MODEL_ID_LENGTH);
        if (model)
            seen.add(model);
        if (seen.size >= MAX_ENABLED_MODELS)
            break;
    }
    return [...seen];
}
function normalizeBudget(raw) {
    if (raw === undefined || raw === null || raw === '')
        return null;
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value) || value <= 0)
        return null;
    return Math.min(value, MAX_CONTEXT_BUDGET);
}
/**
 * AI 服务商配置（模型管理）：内置目录 + 自定义（OpenAI 兼容协议），superadmin 维护。
 * 配置持久化到 store（密钥加密落盘），聊天链路按租户选型解析出 client + model。
 */
let AiProvidersService = AiProvidersService_1 = class AiProvidersService {
    store;
    logger = new Logger(AiProvidersService_1.name);
    records = new Map();
    /** OpenAI client 复用缓存：key = `${id}@${updatedAt}`，配置变更后自动失效 */
    clientCache = new Map();
    secret = resolveAuthSecret();
    constructor(store) {
        this.store = store;
    }
    async onModuleInit() {
        await this.store.whenReady;
        for (const record of this.store.getPersisted().aiProviders) {
            if (record?.id)
                this.records.set(record.id, record);
        }
        if (this.records.size > 0) {
            this.logger.log(`已载入 ${this.records.size} 个 AI 服务商配置`);
        }
    }
    /** 展示顺序：内置目录在前（固定顺序），自定义按创建时间在后 */
    orderedIds() {
        const customs = [...this.records.values()]
            .filter((r) => r.custom)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((r) => r.id);
        return [...AI_PROVIDER_CATALOG.map((e) => e.id), ...customs];
    }
    toSummary(id) {
        const catalog = CATALOG_BY_ID.get(id);
        const record = this.records.get(id);
        const requiresKey = catalog ? catalog.requiresKey : true;
        const apiKey = record ? openSecret(record.apiKeyEnc, this.secret) : null;
        const hasKey = Boolean(apiKey);
        const baseUrl = record?.baseUrl || catalog?.baseUrl || '';
        const enabledModels = record?.enabledModels ?? [];
        return {
            id,
            name: catalog?.label || record?.name || id,
            custom: !catalog,
            baseUrl,
            requiresKey,
            hasKey,
            maskedKey: apiKey ? maskKey(apiKey) : null,
            enabledModels,
            contextBudget: record?.contextBudget ?? null,
            configured: Boolean(baseUrl) && (hasKey || !requiresKey) && enabledModels.length > 0,
            keyUrl: catalog?.keyUrl ?? null,
            updatedAt: record?.updatedAt ?? null,
        };
    }
    list() {
        return this.orderedIds().map((id) => this.toSummary(id));
    }
    /** 租户下拉用：只返回已配置可用的服务商及其启用模型 */
    listSelectable() {
        return this.list()
            .filter((s) => s.configured)
            .map((s) => ({ providerId: s.id, providerName: s.name, models: s.enabledModels }));
    }
    /** 服务商 id 是否存在（内置目录或已创建的自定义） */
    isKnown(id) {
        return CATALOG_BY_ID.has(id) || this.records.has(id);
    }
    upsert(id, input) {
        const catalog = CATALOG_BY_ID.get(id);
        const existing = this.records.get(id);
        if (!catalog && !existing)
            throw new NotFoundException({ error: 'ai provider not found' });
        const now = new Date().toISOString();
        const record = existing
            ? { ...existing, updatedAt: now }
            : {
                id,
                custom: !catalog,
                baseUrl: catalog?.baseUrl || '',
                apiKeyEnc: null,
                enabledModels: [],
                contextBudget: null,
                createdAt: now,
                updatedAt: now,
            };
        if (input.name !== undefined && record.custom) {
            const name = String(input.name || '').trim().slice(0, MAX_NAME_LENGTH);
            if (!name)
                throw new BadRequestException({ error: 'name is required' });
            record.name = name;
        }
        if (input.baseUrl !== undefined) {
            const baseUrl = normalizeBaseUrl(input.baseUrl);
            if (!baseUrl)
                throw new BadRequestException({ error: 'baseUrl is required' });
            // 防密钥外带：改基地址会让后续请求把已存密钥发到新地址，必须同时重新提供密钥
            if (baseUrl !== record.baseUrl && record.apiKeyEnc && input.apiKey === undefined) {
                throw new BadRequestException({ error: '更换 API 基地址需要重新填写 API Key' });
            }
            record.baseUrl = baseUrl;
        }
        if (input.apiKey !== undefined) {
            const key = String(input.apiKey || '').trim();
            record.apiKeyEnc = key ? sealSecret(key, this.secret) : null;
        }
        if (input.enabledModels !== undefined) {
            record.enabledModels = normalizeModels(input.enabledModels);
        }
        if (input.contextBudget !== undefined) {
            record.contextBudget = normalizeBudget(input.contextBudget);
        }
        this.records.set(id, record);
        this.store.saveAiProvider(record);
        return this.toSummary(id);
    }
    createCustom(input) {
        const customCount = [...this.records.values()].filter((r) => r.custom).length;
        if (customCount >= MAX_CUSTOM_AI_PROVIDERS) {
            throw new ConflictException({ error: `custom providers limit reached (${MAX_CUSTOM_AI_PROVIDERS})` });
        }
        const name = String(input.name || '').trim().slice(0, MAX_NAME_LENGTH);
        if (!name)
            throw new BadRequestException({ error: 'name is required' });
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        if (!baseUrl)
            throw new BadRequestException({ error: 'baseUrl is required' });
        let id;
        do {
            id = `custom_${randomBytes(4).toString('hex')}`;
        } while (this.records.has(id));
        const now = new Date().toISOString();
        const record = {
            id,
            name,
            custom: true,
            baseUrl,
            apiKeyEnc: String(input.apiKey || '').trim() ? sealSecret(String(input.apiKey).trim(), this.secret) : null,
            enabledModels: normalizeModels(input.enabledModels),
            contextBudget: normalizeBudget(input.contextBudget),
            createdAt: now,
            updatedAt: now,
        };
        this.records.set(id, record);
        this.store.saveAiProvider(record);
        return this.toSummary(id);
    }
    /** 自定义服务商：整条删除；内置服务商：清除已保存的配置（回到未配置状态） */
    remove(id) {
        const record = this.records.get(id);
        if (!record) {
            if (CATALOG_BY_ID.has(id))
                return; // 内置且本就未配置：幂等
            throw new NotFoundException({ error: 'ai provider not found' });
        }
        this.records.delete(id);
        this.store.deleteAiProvider(id);
    }
    /**
     * 测试连接：用表单里的 baseUrl/apiKey（apiKey 留空则回落到已保存的密钥）调服务商
     * GET /models，成功即返回模型 id 列表（也是"启用的模型"的候选来源）。
     */
    async testConnection(id, override) {
        const catalog = CATALOG_BY_ID.get(id);
        const record = this.records.get(id);
        const baseUrl = normalizeBaseUrl(override.baseUrl ?? (record?.baseUrl || catalog?.baseUrl));
        if (!baseUrl)
            throw new BadRequestException({ error: 'baseUrl is required' });
        // 防密钥外带：只有目标地址与已保存的基地址一致时才回落到存储密钥，
        // 否则任何持 superadmin token 的人都能把 baseUrl 指向自己来截获解密后的密钥
        const storedKeyAllowed = Boolean(record && baseUrl === record.baseUrl);
        const storedKey = storedKeyAllowed ? openSecret(record.apiKeyEnc, this.secret) : null;
        const apiKey = String(override.apiKey || '').trim() || storedKey || '';
        const requiresKey = catalog ? catalog.requiresKey : true;
        if (!apiKey && requiresKey) {
            throw new BadRequestException({
                error: record?.apiKeyEnc ? '更换 API 基地址后测试连接需重新填写 API Key' : 'apiKey is required',
            });
        }
        const client = this.buildClient(id, baseUrl, apiKey);
        try {
            const models = [];
            for await (const model of client.models.list({ timeout: TEST_TIMEOUT_MS })) {
                if (model?.id)
                    models.push(String(model.id));
                if (models.length >= MAX_LISTED_MODELS)
                    break;
            }
            return models.sort((a, b) => a.localeCompare(b));
        }
        catch (error) {
            const status = error?.status ? `${error.status} ` : '';
            const message = error?.error?.message || error?.message || 'unknown error';
            throw new BadRequestException({ error: `连接失败：${status}${message}` });
        }
    }
    /** 系统默认选型：展示顺序里第一个已配置服务商的第一个启用模型 */
    defaultSelection() {
        for (const id of this.orderedIds()) {
            const summary = this.toSummary(id);
            if (summary.configured)
                return { providerId: id, model: summary.enabledModels[0] };
        }
        return null;
    }
    /**
     * 聊天链路解析：租户选型 → 该服务商可用 client + model。
     * 模型已被移出启用列表时回落到该服务商当前默认；服务商不可用时回落到系统默认；
     * 全都没有则返回 null（由 AiService 再回落到环境变量配置）。
     */
    resolve(selection) {
        const attempts = [selection ?? null, this.defaultSelection()];
        for (const attempt of attempts) {
            if (!attempt?.providerId || !attempt.model)
                continue;
            const summary = this.toSummary(attempt.providerId);
            if (!summary.configured)
                continue;
            const model = summary.enabledModels.includes(attempt.model)
                ? attempt.model
                : summary.enabledModels[0];
            const record = this.records.get(attempt.providerId);
            const apiKey = openSecret(record.apiKeyEnc, this.secret) || '';
            const cacheKey = `${record.id}@${record.updatedAt}`;
            let client = this.clientCache.get(cacheKey);
            if (!client) {
                client = this.buildClient(record.id, summary.baseUrl, apiKey);
                if (this.clientCache.size >= 32)
                    this.clientCache.clear(); // 旧配置的 client 随缓存整体淘汰即可
                this.clientCache.set(cacheKey, client);
            }
            return { client, providerId: record.id, model, contextBudget: summary.contextBudget };
        }
        return null;
    }
    buildClient(id, baseUrl, apiKey) {
        // Anthropic 的 /v1/models 只认 x-api-key + anthropic-version；chat/completions 两种都认，统一都带上
        const defaultHeaders = id === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : undefined;
        return new OpenAI({
            apiKey: apiKey || 'not-required', // SDK 要求非空；Ollama 等本地服务不校验
            baseURL: baseUrl,
            timeout: 60_000, // 聊天超时由 AiService 的 abort 控制（30s）；测试连接在请求级传更短超时
            maxRetries: 1,
            defaultHeaders,
        });
    }
};
AiProvidersService = AiProvidersService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [StoreService])
], AiProvidersService);
export { AiProvidersService };
//# sourceMappingURL=ai-providers.service.js.map