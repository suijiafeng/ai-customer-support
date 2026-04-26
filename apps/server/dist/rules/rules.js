export function createFaqSearcher(faqs) {
    const indexedFaqs = faqs.map((faq) => ({
        ...faq,
        normalizedQuestion: normalize(faq.question),
        normalizedKeywords: faq.keywords.map(normalize),
        questionBigrams: bigrams(normalize(faq.question)),
    }));
    return function searchFaqs(message) {
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
            const bigramScore = msgBigramsList.reduce((best, grams) => Math.max(best, bigramDice(faq.questionBigrams, grams)), 0);
            const score = keywordScore + bigramScore;
            return { ...faq, score };
        })
            .filter((faq) => faq.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(({ normalizedQuestion, normalizedKeywords, questionBigrams, ...faq }) => faq);
    };
}
const QUERY_REPLACEMENTS = [
    ['空档', '档期'],
    ['有空吗', '有档期吗'],
    ['联系人工', '联系客服'],
    ['联系真人', '联系客户服务人员'],
    ['人工', '客服'],
    ['vue3', 'vue'],
    ['nextjs', 'next.js'],
    ['next', 'next.js'],
    ['小页面', '落地页'],
    ['小站', '官网'],
];
const BUSINESS_TERMS = [
    '开发',
    '网站',
    '官网',
    '页面',
    '小程序',
    '后台',
    '系统',
    '技术栈',
    '前端',
    '后端',
    '报价',
    '预算',
    '排期',
    '档期',
    '合作',
    '项目',
    '咨询',
    '作品集',
    '案例',
    'seo',
    '部署',
    '域名',
];
const OUT_OF_SCOPE_TERMS = [
    '天气',
    '双色球',
    '彩票',
    '股票',
    '基金',
    '币价',
    '比特币',
    '理财',
    '算命',
    '星座',
    '占卜',
    '塔罗',
    '减肥',
    '食谱',
    '做饭',
    '医生',
    '处方',
    '病情',
    '法律咨询',
    '离婚',
    '合同纠纷',
    '贷款',
    '信用卡',
    '考试答案',
    '写作业',
    '代写',
];
/**
 * 轻量查询扩展：保留原始归一化串，同时生成少量同义替换变体。
 * 目的：提升口语/别名问法召回，不引入外部依赖或复杂索引。
 */
export function expandQueryVariants(normalized) {
    const variants = new Set([normalized]);
    for (const [from, to] of QUERY_REPLACEMENTS) {
        if (normalized.includes(from)) {
            variants.add(normalized.replace(from, to));
        }
    }
    return [...variants];
}
export function detectIntent(message, matchedFaqs = []) {
    const normalized = normalize(message);
    if (hasAny(normalized, [
        '转人工',
        '找人工',
        '真人沟通',
    ])) {
        return 'human_handoff';
    }
    if (extractInquiryId(message) || hasAny(normalized, ['项目进展', '咨询进展', '项目编号', '咨询编号', '项目状态'])) {
        return 'inquiry_status';
    }
    if (isOutOfScopeQuery(normalized)) {
        return 'out_of_scope';
    }
    if (hasAny(normalized, ['报价', '多少钱', '价格', '费用', '预算', '怎么收费'])) {
        return 'pricing';
    }
    if (hasAny(normalized, ['合作流程', '怎么合作', '开发流程', '项目流程', '交付时间', '开发周期'])) {
        return 'collaboration';
    }
    if (hasAny(normalized, ['技术栈', 'react', 'vue', 'next.js', 'typescript', 'javascript'])) {
        return 'tech_stack';
    }
    if (hasAny(normalized, ['作品集', '案例', '过往项目', 'portfolio'])) {
        return 'portfolio';
    }
    if (hasAny(normalized, ['招聘', '全职', '兼职', '长期合作', '工作机会'])) {
        return 'hiring';
    }
    return matchedFaqs[0]?.intent || 'general';
}
/**
 * 边界识别：命中明显非开发咨询领域词，且不存在业务信号时，标记为 out_of_scope。
 */
export function isOutOfScopeQuery(normalized) {
    return hasAny(normalized, OUT_OF_SCOPE_TERMS) && !hasAny(normalized, BUSINESS_TERMS);
}
export function shouldHandoff(message, intent, matchedFaqs = [], sentiment, inquiry, aiAvailable = false) {
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
export function findInquiryByMessage(message, inquiries) {
    const inquiryId = extractInquiryId(message);
    if (!inquiryId) {
        return null;
    }
    return inquiries.find((inquiry) => normalize(inquiry.id) === normalize(inquiryId)) || null;
}
export function extractInquiryId(message) {
    const match = String(message).match(/\b[A-Z]\d{4,}\b/i);
    return match ? match[0].toUpperCase() : null;
}
export function detectSentiment(message) {
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
// 去掉首尾语气词与标点再比对，容忍「在吗？」「好的~」「谢谢！！」这类写法
const TRAILING_NOISE = /[呀啊呢嘛么哟哇~～!！?？。.，,…\s]+$/g;
const LEADING_NOISE = /^[~～!！?？。.，,…\s]+/g;
// 同一条消息固定取同一条回复（可复现），不同消息在词库的多条回复间轮换
function stripNoise(value) {
    return value.replace(TRAILING_NOISE, '').replace(LEADING_NOISE, '');
}
function pickReply(replies, seed) {
    const n = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return replies[n % replies.length] || '';
}
/**
 * 口水话/寒暄/测试消息匹配（数据驱动，词库见 data/small-talk.json）。
 * 整条短消息精确匹配：命中直接用内置回复，不走 FAQ 检索、不建跟进事项、不调 AI。
 */
export function createSmallTalkMatcher(groups) {
    // 词条与消息做同样的归一化+去语气词处理，保证「在干嘛呢」能命中词条「在干嘛」
    const indexed = groups.map((group) => ({
        ...group,
        normalizedTerms: new Set(group.terms.flatMap((term) => {
            const normalized = normalize(term);
            const stripped = stripNoise(normalized);
            return stripped ? [normalized, stripped] : [normalized];
        })),
    }));
    const testingGroup = indexed.find((group) => group.intent === 'testing');
    return function matchSmallTalk(message) {
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
export function normalize(value) {
    return String(value).toLowerCase().replace(/\s+/g, '');
}
export function hasAny(value, terms) {
    return terms.some((term) => value.includes(normalize(term)));
}
/**
 * 生成字符串的 bigram 集合（相邻两字符对），用于 FAQ 搜索相似度计算。
 * 例："报价方式" → Set {"报价","价方","方式"}
 */
export function bigrams(text) {
    const result = new Set();
    for (let i = 0; i < text.length - 1; i++) {
        result.add(text[i] + text[i + 1]);
    }
    return result;
}
/**
 * Dice 系数：2 × |A ∩ B| / (|A| + |B|)。
 * 返回 [0, 1] 的相似度；两个空集返回 0。
 */
export function bigramDice(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let overlap = 0;
    for (const gram of a) {
        if (b.has(gram))
            overlap++;
    }
    return (2 * overlap) / (a.size + b.size);
}
//# sourceMappingURL=rules.js.map