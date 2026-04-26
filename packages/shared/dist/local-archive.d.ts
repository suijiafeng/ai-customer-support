/**
 * 对话本地归档：服务端内存只保留每会话最近 MAX_MESSAGES_PER_SESSION 条（热窗口），
 * 溢出的旧消息由会话双方（访客 widget / 客服工作台）各自归档到浏览器 localStorage。
 * 渲染时「本地归档 ∪ 服务端窗口」按时间合并去重，双方都能看到完整历史，
 * 服务端重启或内存淘汰也不会让界面上的记录消失。
 *
 * 体积控制：图片附件本体不写入本地存储（落盘降级为 [图片] 占位）；但 merge 的返回值
 * 会对仍在服务端窗口内的消息透传原始对象（保留 attachments），只有窗口外的旧消息才用占位，
 * 因此界面不会因合并而把图片抹成「[图片]」文字。每会话保留最近 maxMessages 条，
 * 归档会话总数按 LRU 保留 maxSessions 个。
 */
export interface ArchivedMessage {
    id: string;
    role?: string;
    actor?: string;
    content: string;
    agentId?: string | null;
    agentName?: string | null;
    createdAt?: string;
    /** 原消息带图片附件（附件本体不入档） */
    hasAttachments?: boolean;
}
export interface MessageArchive {
    /** 合并一批服务端消息进归档并落盘，返回「归档 ∪ 本批」的完整时间线（窗口内消息保留原始附件） */
    merge(sessionId: string, messages: any[]): ArchivedMessage[];
    /** 读取某会话的归档 */
    load(sessionId: string): ArchivedMessage[];
}
export interface ArchiveOptions {
    /** 每会话归档条数上限 */
    maxMessages?: number;
    /** 归档会话数上限（LRU 淘汰最久未活跃的） */
    maxSessions?: number;
}
export declare function createMessageArchive(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, namespace: string, { maxMessages, maxSessions }?: ArchiveOptions): MessageArchive;
