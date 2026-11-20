// 访客编号展示：服务端记录的访客编号形如 v-d06f1d90e0fa440db5（挂件本地访客 ID 截取前 20 位，
// 不是浏览器里的完整 ID，也不是会话 ID），整串展示太长。
// 工作台所有显示访客名称的地方（会话列表、聊天头部、消息气泡）统一用短码「访客 8F2A」；
// 访客编号原文放在 title 里，并在详情栏「访客编号」一行显示、可复制（可直接粘贴到搜索框找到该会话）。

const AUTO_CODE = /^v-([0-9a-f]{8,})$/i;
// 服务端兜底名称：「访客 <访客编号>」
const AUTO_NAME = /^访客\s+(\S+)$/;

/** 访客编号短码：v-xxxx 取末 4 位大写；其他过长的编号保留首尾、中间省略 */
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
