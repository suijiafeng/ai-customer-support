import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import type { AiUsage, Inquiry, Message, Ticket } from '@assistflow/shared';
import { appConfig } from '../config.js';
import type { HandoffDecision, ScoredFaq } from '../rules/rules.js';
import { ModelSettingsService, type ActiveConnection } from './model-settings.service.js';

export interface BuildReplyParams {
  message: string;
  history: Message[];
  matchedFaqs: ScoredFaq[];
  intent: string;
  handoff: HandoffDecision;
  inquiry: Inquiry | null;
  ticket: Ticket | null;
  /** 租户指定的模型 ID；空 / 不可用时用默认模型 */
  modelId?: string | null;
}

export interface ReplyResult {
  text: string;
  ai: AiUsage;
}

/** 流式增量回调：每收到一段模型输出调用一次 */
export type ReplyDeltaHandler = (delta: string) => void;

/**
 * AI 超时（毫秒）。非流式：整次请求上限；流式：两段输出之间的最大空闲，每收到一段就重置——
 * 固定 30s 总上限会把正在正常吐字的长回复腰斩，再用兜底话术覆盖访客已经看到的内容。
 */
const AI_TIMEOUT_MS = 30_000;

/** AI 适配层：任意 OpenAI 兼容服务（AI_BASE_URL/AI_MODEL/AI_API_KEY）+ 本地规则降级。 */
@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly modelSettings: ModelSettingsService) {}

  /**
   * OpenAI 兼容客户端：延迟构建 + 按连接参数（Key + 地址）缓存。
   * 租户可指定不同模型，所以同时可能存在多个客户端；改了模型配置后下次调用自动用新参数。
   */
  private readonly clients = new Map<string, OpenAI>();

  private clientFor(conn: ActiveConnection): OpenAI | null {
    if (!conn.apiKey) return null;
    const cacheKey = `${conn.apiKey}\n${conn.baseUrl}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      // 配置频繁变更时防止旧客户端无限堆积
      if (this.clients.size >= 32) this.clients.clear();
      client = new OpenAI({ apiKey: conn.apiKey, ...(conn.baseUrl ? { baseURL: conn.baseUrl } : {}) });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  private buildClient(): OpenAI | null {
    return this.clientFor(this.modelSettings.getActiveConnection());
  }

  /** 运营侧可修改的 AI 人设指令（从 data/ai-persona.txt 加载） */
  private instructions = '';
  private personaWatcher: FSWatcher | null = null;
  private personaReloadTimer: ReturnType<typeof setTimeout> | null = null;

  get provider(): string {
    return this.modelSettings.getActiveProvider();
  }

  getActiveModel(): string {
    return this.modelSettings.getActiveModel();
  }

  getConfiguredClient(): OpenAI | null {
    return this.buildClient();
  }

  getActiveClient(): OpenAI | null {
    if (!appConfig.aiFeatureEnabled) {
      return null;
    }
    return this.getConfiguredClient();
  }

  async onModuleInit() {
    await this.loadPersona();
    this.watchPersona();
  }

  onModuleDestroy() {
    if (this.personaReloadTimer) {
      clearTimeout(this.personaReloadTimer);
      this.personaReloadTimer = null;
    }
    this.personaWatcher?.close();
    this.personaWatcher = null;
  }

  /** 从 data/ai-persona.txt 加载 system prompt；文件不存在时回退为内置默认值。 */
  async loadPersona(): Promise<void> {
    const personaPath = path.join(appConfig.dataDir, 'ai-persona.txt');
    try {
      this.instructions = (await fs.readFile(personaPath, 'utf8')).trim();
    } catch {
      this.logger.warn(`ai-persona.txt 未找到，使用内置通用默认人设（${personaPath}）`);
      this.instructions = [
        '你是网站上的中文 AI 客服助手，以亲切自然的口吻和访客一对一交流。',
        '优先根据提供的本地 FAQ、业务信息以及最近对话回答。',
        '知识库未命中时，可以回答与业务相关的通用问题；涉及具体价格、时间、未公开信息或承诺时必须说明需要人工客服确认。',
        '始终使用第一人称「我」回答，像面对面聊天一样亲切、自然、不打官腔；称呼对方为「你」。',
        '语气简洁、礼貌、可执行，不要过度堆砌语气词。',
        '只有访客明确要求联系人工客服或转人工时，needHuman 才会为 true。',
        '如果 needHuman 为 true，不要代替商家承诺；请说明客服暂时不在线，并请访客留下联系方式和需求摘要，后续会有专人联系。',
        '不要编造价格、时间、业务承诺或进展。',
      ].join('\n');
    }
  }

  /** 监听 ai-persona.txt 变更，运行时热更新人设（防抖 500ms），无需重启服务。 */
  private watchPersona(): void {
    const personaPath = path.join(appConfig.dataDir, 'ai-persona.txt');
    try {
      this.personaWatcher = watch(personaPath, () => {
        if (this.personaReloadTimer) clearTimeout(this.personaReloadTimer);
        this.personaReloadTimer = setTimeout(async () => {
          await this.loadPersona();
          this.logger.log('ai-persona.txt 变更，已热更新 AI 人设');
        }, 500);
      });
    } catch {
      // 文件不存在或平台不支持 watch 时静默降级
    }
  }

  async buildReply(params: BuildReplyParams, onDelta?: ReplyDeltaHandler): Promise<ReplyResult> {
    const { message, history, matchedFaqs, intent, handoff, inquiry, ticket } = params;
    // 本次回复使用的模型：租户专属优先，不可用时回退默认（整次回复内保持一致）
    const conn = this.modelSettings.getConnectionFor(params.modelId);
    const fallback = this.buildFallbackReply(matchedFaqs, handoff, inquiry, ticket, intent, message);
    const fallbackResult: ReplyResult = {
      text: fallback,
      ai: {
        provider: conn.provider,
        model: conn.model,
        used: false,
        fallback: true,
        error: null,
      },
    };

    const activeClient = appConfig.aiFeatureEnabled ? this.clientFor(conn) : null;

    if (!activeClient) {
      return {
        ...fallbackResult,
        ai: {
          ...fallbackResult.ai,
          error: appConfig.aiFeatureEnabled ? 'AI provider is not configured' : 'AI feature is disabled',
        },
      };
    }

    const knowledge = matchedFaqs
      .map((faq, index) => `${index + 1}. ${faq.question}\n${faq.answer}`)
      .join('\n\n');
    const compactHistory = history
      .map((item) => `${item.role === 'user' ? '访客' : '助手或开发者'}：${item.content}`)
      .join('\n');

    const prompt = [
      `意图：${intent}`,
      `needHuman：${handoff.needHuman}`,
      `联系人工客服原因：${handoff.reason}`,
      `项目或咨询信息：\n${inquiry ? JSON.stringify(inquiry, null, 2) : '无'}`,
      `跟进事项：\n${ticket ? JSON.stringify(ticket, null, 2) : '无'}`,
      `最近对话：\n${compactHistory || '无'}`,
      `知识库：\n${knowledge || '无命中'}`,
      `用户消息：${message}`,
    ].join('\n\n');

    const abort = new AbortController();
    let timer = setTimeout(() => abort.abort(), AI_TIMEOUT_MS);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => abort.abort(), AI_TIMEOUT_MS);
    };
    // 流式已经推给访客的文本：中途失败时保留它，而不是用兜底话术把已显示的内容替换掉
    let streamed = '';

    try {
      let text: string | undefined;

      if (onDelta) {
        // 流式：增量转发给调用方，同时拼出完整文本
        const stream = await activeClient.chat.completions.create(
          {
            model: conn.model,
            stream: true,
            messages: [
              { role: 'system', content: this.instructions },
              { role: 'user', content: prompt },
            ],
          },
          { signal: abort.signal }
        );
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            streamed += delta;
            resetTimer();
            onDelta(delta);
          }
        }
        text = streamed.trim();
      } else {
        const completion = await activeClient.chat.completions.create(
          {
            model: conn.model,
            messages: [
              { role: 'system', content: this.instructions },
              { role: 'user', content: prompt },
            ],
          },
          { signal: abort.signal }
        );
        text = completion.choices[0]?.message?.content?.trim();
      }

      return {
        text: text || fallback,
        ai: {
          provider: conn.provider,
          model: conn.model,
          used: Boolean(text),
          fallback: !text,
          error: null,
        },
      };
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const formattedError = isTimeout ? `timeout after ${AI_TIMEOUT_MS}ms` : formatAiError(error);
      const partial = streamed.trim();
      if (partial) {
        // 访客已经看到前半段：按「AI 已回答但未完整」处理，客服侧 workflow.ai.error 可见原因
        this.logger.warn(`AI 流式中断，保留已输出内容：${formattedError}`);
        return {
          text: partial,
          ai: { provider: conn.provider, model: conn.model, used: true, fallback: false, error: formattedError },
        };
      }
      this.logger.warn(`AI 请求失败，降级为本地规则：${formattedError}`);
      return {
        ...fallbackResult,
        ai: { ...fallbackResult.ai, error: formattedError },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  buildFallbackReply(
    matchedFaqs: ScoredFaq[],
    handoff: HandoffDecision,
    inquiry: Inquiry | null,
    ticket: Ticket | null,
    intent: string,
    /** 访客原话：仅用于在同意图的多条兜底话术里稳定选一条 */
    message = ''
  ): string {
    if (intent === 'out_of_scope') {
      return fillTemplate(REPLY_TEMPLATES.outOfScope, {
        businessTopics: REPLY_TEMPLATES.businessTopics,
      });
    }

    if (handoff.needHuman) {
      const ticketText = ticket
        ? fillTemplate(REPLY_TEMPLATES.handoffWithTicket, { ticketId: ticket.id })
        : REPLY_TEMPLATES.handoffWithoutTicket;
      const inquiryText = inquiry
        ? fillTemplate(REPLY_TEMPLATES.handoffInquiry, {
            type: inquiry.type,
            id: inquiry.id,
            title: inquiry.title,
          })
        : '';
      return `好的，收到！${ticketText}${inquiryText}${REPLY_TEMPLATES.handoffSuffix}`;
    }

    if (inquiry) {
      return fillTemplate(REPLY_TEMPLATES.inquiryStatus, {
        type: inquiry.type,
        id: inquiry.id,
        title: inquiry.title,
        status: inquiry.statusText,
        nextStep: inquiry.nextStep,
        eta: inquiry.eta,
      });
    }

    return matchedFaqs[0]?.answer || pickFallbackScript(intent, message);
  }
}

/** 回复模板：从 data/reply-templates.json 加载，见文件内注释 */
interface ReplyTemplates {
  businessTopics: string;
  outOfScope: string;
  handoffWithTicket: string;
  handoffWithoutTicket: string;
  handoffInquiry: string;
  handoffSuffix: string;
  inquiryStatus: string;
}

function loadReplyTemplates(): ReplyTemplates {
  try {
    const raw = readFileSync(path.join(appConfig.dataDir, 'reply-templates.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      businessTopics: String(parsed.businessTopics ?? ''),
      outOfScope: String(parsed.outOfScope ?? ''),
      handoffWithTicket: String(parsed.handoffWithTicket ?? ''),
      handoffWithoutTicket: String(parsed.handoffWithoutTicket ?? ''),
      handoffInquiry: String(parsed.handoffInquiry ?? ''),
      handoffSuffix: String(parsed.handoffSuffix ?? ''),
      inquiryStatus: String(parsed.inquiryStatus ?? ''),
    };
  } catch {
    return {
      businessTopics: '',
      outOfScope: '',
      handoffWithTicket: '',
      handoffWithoutTicket: '',
      handoffInquiry: '',
      handoffSuffix: '',
      inquiryStatus: '',
    };
  }
}

const REPLY_TEMPLATES: ReplyTemplates = loadReplyTemplates();

/** 简单模板填充：{key} 替换为 values[key]，缺失的键保留原样 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

/**
 * 兜底话术：从 data/fallback-scripts.json 加载，按意图分组。
 * AI 不可用（未配置 / 超时 / 报错）且知识库没命中时使用，让访客至少拿到一句
 * 「对得上话题」的回复，而不是千篇一律的「没找到答案」。
 * 文件缺失时降级为空配置（pickFallbackScript 返回空串，调用方回落到通用提示）。
 */
function loadFallbackScripts(): Record<string, string[]> {
  try {
    const raw = readFileSync(path.join(appConfig.dataDir, 'fallback-scripts.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('_') || !Array.isArray(v)) continue;
      out[k] = (v as unknown[]).filter((s): s is string => typeof s === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

export const FALLBACK_SCRIPTS: Record<string, string[]> = loadFallbackScripts();

/**
 * 按意图挑一条兜底话术。同一意图下有多个变体时按 seed 稳定选取——
 * 同一个问题每次得到同样的回答（可测试），不同问题之间又不会千篇一律。
 */
export function pickFallbackScript(intent: string, seed = ''): string {
  const scripts = FALLBACK_SCRIPTS[intent] || FALLBACK_SCRIPTS.general || [];
  if (scripts.length === 0) return '';
  if (scripts.length === 1) return scripts[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  return scripts[hash % scripts.length];
}

export function formatAiError(error: any): string {
  const status = error?.status ? `${error.status} ` : '';
  const message = error?.error?.message || error?.message || 'unknown error';
  return `${status}${message}`;
}
