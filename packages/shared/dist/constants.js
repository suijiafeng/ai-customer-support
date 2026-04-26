/** 跨端共享常量：限额、状态机、SSE 事件名。 */
export const LIMITS = {
    MAX_CONVERSATIONS: 200,
    MAX_MESSAGES_PER_SESSION: 80,
    MAX_AI_HISTORY: 8,
    MAX_SESSIONS: 200,
    MAX_TICKETS: 200,
    MAX_ATTACHMENTS: 4,
    MAX_ATTACHMENT_BYTES: 2 * 1024 * 1024,
};
/** 工单状态机允许的流转 */
export const TICKET_TRANSITIONS = {
    open: ['open', 'processing', 'resolved'],
    processing: ['processing', 'resolved'],
    resolved: ['resolved'],
};
/** SSE 事件名 */
export const SSE_EVENTS = {
    SESSION: 'session',
    SESSIONS: 'sessions',
};
