/** 跨端共享常量：限额、状态机、SSE 事件名。 */
export declare const LIMITS: {
    readonly MAX_CONVERSATIONS: 200;
    readonly MAX_MESSAGES_PER_SESSION: 80;
    readonly MAX_AI_HISTORY: 8;
    readonly MAX_SESSIONS: 200;
    readonly MAX_TICKETS: 200;
    readonly MAX_ATTACHMENTS: 4;
    readonly MAX_ATTACHMENT_BYTES: number;
};
/** 工单状态机允许的流转 */
export declare const TICKET_TRANSITIONS: Record<string, readonly string[]>;
/** SSE 事件名 */
export declare const SSE_EVENTS: {
    readonly SESSION: "session";
    readonly SESSIONS: "sessions";
};
