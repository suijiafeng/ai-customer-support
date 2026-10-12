// 规则引擎（纯函数）。自 server/rules.js 原样平移，行为不变。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Faq, Inquiry, Sentiment } from '@assistflow/shared';
import { appConfig } from '../config.js';

export interface ScoredFaq extends Faq {
  score: number;
}

/** 业务词表：queryReplacements / businessTerms / outOfScopeTerms / intentKeywords，见 data/business-terms.json */
export interface BusinessTermsConfig {
  queryReplacements: Array<[string, string]>;
  businessTerms: string[];
  outOfScopeTerms: string[];
  intentKeywords: Record<string, string[]>;
}

const EMPTY_TERMS: BusinessTermsConfig = {
  queryReplacements: [],
  businessTerms: [],
  outOfScopeTerms: [],
  intentKeywords: {},
};

/**
 * 从 data/business-terms.json 加载业务词表；文件缺失/解析失败时用空配置降级
 *（意图回落到 FAQ 匹配或 general，不抛错）。
 */
function loadBusinessTerms(): BusinessTermsConfig {
  try {
    const raw = readFileSync(path.join(appConfig.dataDir, 'business-terms.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      queryReplacements: Array.isArray(parsed.queryReplacements) ? parsed.queryReplacements : [],
      businessTerms: Array.isArray(parsed.businessTerms) ? parsed.businessTerms : [],
      outOfScopeTerms: Array.isArray(parsed.outOfScopeTerms) ? parsed.outOfScopeTerms : [],
      intentKeywords:
        parsed.intentKeywords && typeof parsed.intentKeywords === 'object' ? parsed.intentKeywords : {},
    };
  } catch {
    return EMPTY_TERMS;
  }
}

const TERMS: BusinessTermsConfig = loadBusinessTerms();

/** 供测试或热更新覆盖业务词表 */
export function setBusinessTerms(terms: Partial<BusinessTermsConfig>): void {
  Object.assign(TERMS, {
    queryReplacements: terms.queryReplacements ?? TERMS.queryReplacements,
    businessTerms: terms.businessTerms ?? TERMS.businessTerms,
    outOfScopeTerms: terms.outOfScopeTerms ?? TERMS.outOfScopeTerms,
    intentKeywords: terms.intentKeywords ?? TERMS.intentKeywords,
  });
}

export function getBusinessTerms(): BusinessTermsConfig {
  return TERMS;
}

export function createFaqSearcher(faqs: Faq[]) {
  const indexedFaqs = faqs.map((faq) => ({
    ...faq,
    normalizedQuestion: normalize(faq.question),
    normalizedKeywords: faq.keywords.map(normalize),
    questionBigrams: bigrams(normalize(faq.question)),
  }));

  return function searchFaqs(message: string): ScoredFaq[] {
    const normalized = normalize(message);
    const variants = expandQueryVariants(normalized);
    const msgBigramsList = variants.map((v) => bigrams(v));
    const minScore = normalized.length <= 6 ? 0.85 : 1;

    return indexedFaqs
      .map((faq) => {
        // 关键词完整命中（权重高）
        const keywordScore = faq.normalizedKeywords.reduce((score, keyword) => {
          return variants.some((variant) => variant.includes(keyword)) ? score + 3 : score;
        }, 0);
        // Bigram 重叠率：分子 = 共有 bigram 数，分母 = 两者 bigram 总数的均值（Dice 系数）
        const bigramScore = msgBigramsList.reduce(
          (best, grams) => Math.max(best, bigramDice(faq.questionBigrams, grams)),
          0
        );
        const score = keywordScore + bigramScore;

        return { ...faq, score };
      })
      .filter((faq) => faq.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ normalizedQuestion, normalizedKeywords, questionBigrams, ...faq }) => faq);
  };
}

/** 查询扩展与意图识别用的词表见 TERMS（data/business-terms.json），此处不再硬编码。 */

/**
 * 轻量查询扩展：保留原始归一化串，同时生成少量同义替换变体。
 * 目的：提升口语/别名问法召回，不引入外部依赖或复杂索引。
 */
export function expandQueryVariants(normalized: string): string[] {
  const variants = new Set<string>([normalized]);
  for (const [from, to] of TERMS.queryReplacements) {
    if (normalized.includes(from)) {
      variants.add(normalized.replace(from, to));
    }
  }
  return [...variants];
}

export function detectIntent(message: string, matchedFaqs: ScoredFaq[] = []): string {
  const normalized = normalize(message);
  const kw = TERMS.intentKeywords;

  if (hasAny(normalized, kw.human_handoff ?? [])) {
    return 'human_handoff';
  }
  if (extractInquiryId(message) || hasAny(normalized, kw.inquiry_status ?? [])) {
    return 'inquiry_status';
  }
  if (isOutOfScopeQuery(normalized)) {
    return 'out_of_scope';
  }
  for (const intent of ['pricing', 'collaboration', 'tech_stack', 'portfolio', 'hiring']) {
    if (hasAny(normalized, kw[intent] ?? [])) {
      return intent;
    }
  }

  return matchedFaqs[0]?.intent || 'general';
}

/**
 * 边界识别：命中明显非开发咨询领域词，且不存在业务信号时，标记为 out_of_scope。
 */
export function isOutOfScopeQuery(normalized: string): boolean {
  return hasAny(normalized, TERMS.outOfScopeTerms) && !hasAny(normalized, TERMS.businessTerms);
}

export interface HandoffDecision {
  needHuman: boolean;
  reason: string;
}

export function shouldHandoff(
  message: string,
  intent: string,
  matchedFaqs: ScoredFaq[] = [],
  sentiment?: Sentiment,
  inquiry?: Inquiry | null,
  aiAvailable = false
): HandoffDecision {
  if (intent === 'human_handoff') {
    return { needHuman: true, reason: '访客明确要求联系人工客服' };
  }
  if (intent === 'out_of_scope') {
    return { needHuman: false, reason: '问题超出知识库边界，给出范围说明并引导回业务咨询' };
  }
  if (inquiry) {
    return { needHuman: false, reason: '项目或咨询查询已命中' };
  }
  if (intent === 'inquiry_status') {
    return { needHuman: false, reason: '未查询到项目或咨询编号，继续由助手引导' };
  }
  if (matchedFaqs.length === 0) {
    return aiAvailable
      ? { needHuman: false, reason: '知识库未命中，交由 AI 回答' }
      : { needHuman: false, reason: '知识库未命中，请访客补充问题' };
  }

  return { needHuman: false, reason: 'FAQ 可处理' };
}

export function findInquiryByMessage(message: string, inquiries: Inquiry[]): Inquiry | null {
  const inquiryId = extractInquiryId(message);

  if (!inquiryId) {
    return null;
  }

  return inquiries.find((inquiry) => normalize(inquiry.id) === normalize(inquiryId)) || null;
}

export function extractInquiryId(message: string): string | null {
  const match = String(message).match(/\b[A-Z]\d{4,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

export function detectSentiment(message: string): Sentiment {
  const normalized = normalize(message);
  const negativeTerms = ['生气', '太差', '垃圾', '骗人', '恶心', '失望', '投诉', '离谱'];
  const positiveTerms = ['谢谢', '感谢', '很好', '满意'];

  if (hasAny(normalized, negativeTerms)) {
    return 'negative';
  }
  if (hasAny(normalized, positiveTerms)) {
    return 'positive';
  }

  return 'neutral';
}

export interface SmallTalkGroup {
  intent: string;
  label?: string;
  terms: string[];
  replies: string[];
}

export interface SmallTalkMatch {
  intent: string;
  reply: string;
}

// 去掉首尾语气词与标点再比对，容忍「在吗？」「好的~」「谢谢！！」这类写法
const TRAILING_NOISE = /[呀啊呢嘛么哟哇~～!！?？。.，,…\s]+$/g;
const LEADING_NOISE = /^[~～!！?？。.，,…\s]+/g;

// 同一条消息固定取同一条回复（可复现），不同消息在词库的多条回复间轮换
function stripNoise(value: string): string {
  return value.replace(TRAILING_NOISE, '').replace(LEADING_NOISE, '');
}

function pickReply(replies: string[], seed: string): string {
  const n = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return replies[n % replies.length] || '';
}

/**
 * 口水话/寒暄/测试消息匹配（数据驱动，词库见 data/small-talk.json）。
 * 整条短消息精确匹配：命中直接用内置回复，不走 FAQ 检索、不建跟进事项、不调 AI。
 */
export function createSmallTalkMatcher(groups: SmallTalkGroup[]) {
  // 词条与消息做同样的归一化+去语气词处理，保证「在干嘛呢」能命中词条「在干嘛」
  const indexed = groups.map((group) => ({
    ...group,
    normalizedTerms: new Set(
      group.terms.flatMap((term) => {
        const normalized = normalize(term);
        const stripped = stripNoise(normalized);
        return stripped ? [normalized, stripped] : [normalized];
      })
    ),
  }));
  const testingGroup = indexed.find((group) => group.intent === 'testing');

  return function matchSmallTalk(message: string): SmallTalkMatch | null {
    const normalized = stripNoise(normalize(message));

    // 原文非空但剥完只剩标点/语气词（如「???」「。。。」），按测试消息处理
    if (!normalized) {
      return normalize(message) && testingGroup
        ? { intent: 'testing', reply: pickReply(testingGroup.replies, message) }
        : null;
    }
    if (normalized.length > 10) {
      return null;
    }
    // 纯数字（111 / 123456）按测试消息处理；88/666 留给告别和夸奖词表
    if (/^\d{1,6}$/.test(normalized) && normalized !== '88' && normalized !== '666' && testingGroup) {
      return { intent: 'testing', reply: pickReply(testingGroup.replies, message) };
    }

    for (const group of indexed) {
      if (group.normalizedTerms.has(normalized)) {
        return { intent: group.intent, reply: pickReply(group.replies, message) };
      }
    }

    return null;
  };
}

export function normalize(value: unknown): string {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

export function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalize(term)));
}

/**
 * 生成字符串的 bigram 集合（相邻两字符对），用于 FAQ 搜索相似度计算。
 * 例："报价方式" → Set {"报价","价方","方式"}
 */
export function bigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    result.add(text[i] + text[i + 1]);
  }
  return result;
}

/**
 * Dice 系数：2 × |A ∩ B| / (|A| + |B|)。
 * 返回 [0, 1] 的相似度；两个空集返回 0。
 */
export function bigramDice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const gram of a) {
    if (b.has(gram)) overlap++;
  }
  return (2 * overlap) / (a.size + b.size);
}
