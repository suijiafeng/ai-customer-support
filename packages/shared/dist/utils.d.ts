/** 跨端共享工具函数（UI 渲染辅助） */
/** 将 ISO 时间戳格式化为 HH:MM（24 小时制，中文 locale）。无效输入返回空字符串。 */
export declare function fmtTime(iso?: string): string;
export interface LinkPart {
    link: boolean;
    value: string;
}
/** 将纯文本切分为「文本片段 / 链接片段」数组，供安全渲染可点击链接使用。 */
export declare function linkParts(text: string): LinkPart[];
