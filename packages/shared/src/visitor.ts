// 访客标识展示：服务端生成的标识形如 v-d06f1d90e0fa440db5（20 位），整串展示太长。
// 工作台所有显示访客名称的地方（会话列表、聊天头部、消息气泡）统一用短码「访客 8F2A」；
// 完整标识放在 title 里，并在详情栏「访客标识」一行完整显示、可复制。

const AUTO_CODE = /^v-([0-9a-f]{8,})$/i;
// 服务端兜底名称：「访客 <访客标识>」
const AUTO_NAME = /^访客\s+(\S+)$/;

/** 访客标识短码：v-xxxx 取末 4 位大写；其他过长的标识保留首尾、中间省略 */
export function shortVisitorCode(code: string): string {
  const m = AUTO_CODE.exec(code);
  if (m) return m[1].slice(-4).toUpperCase();
  return code.length > 12 ? `${code.slice(0, 6)}…${code.slice(-4)}` : code;
}

/** 会话展示名：只缩短自动生成的「访客 <标识>」，访客自己留的名字原样显示 */
export function visitorDisplayName(name: string): string {
  const m = AUTO_NAME.exec(name || '');
  return m ? `访客 ${shortVisitorCode(m[1])}` : name;
}
