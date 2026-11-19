import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { appConfig } from '../config.js';
import {
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  signSseTicket,
  verifySseTicket,
  type AgentRole,
} from './jwt.js';
import { signVisitorToken, verifyVisitorToken } from './visitor-token.js';

export interface AgentAccount {
  id: string;
  name: string;
  salt: string;
  passwordHash: string;
  role?: AgentRole;
  /** 停用后无法登录；缺省视为启用（兼容旧数据）。 */
  active?: boolean;
}

/** 脱敏后的账号视图：绝不向外暴露 salt / passwordHash。 */
export interface PublicAgent {
  id: string;
  name: string;
  role: AgentRole;
  active: boolean;
}

export interface AuthenticatedAgent {
  id: string;
  name: string;
  role: AgentRole;
}

/** 仓库与 README 公开的演示口令。生产环境默认不能用它登录。 */
const DEMO_PASSWORD = '123456';

/**
 * 本地开发（NODE_ENV 不是 production）始终允许演示口令。
 * 生产环境只有显式 ALLOW_DEMO_CREDENTIALS=true/1/yes/on 才允许，便于一次性引导后关掉。
 */
function demoCredentialsAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = String(process.env.ALLOW_DEMO_CREDENTIALS ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
}

function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const dir = process.env.DATA_DIR || appConfig.dataDir;
  const file = path.join(dir, '.auth_secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const generated = randomBytes(32).toString('hex');
  let persisted = false;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    persisted = true;
  } catch {}
  if (process.env.NODE_ENV === 'production') {
    new Logger('AuthService').warn(
      persisted
        ? '未配置 AUTH_SECRET，已自动生成并持久化到 DATA_DIR/.auth_secret。多实例部署请显式设置统一的 AUTH_SECRET。'
        : '未配置 AUTH_SECRET 且无法写入数据目录，本次使用内存随机密钥：重启后客服需重新登录。建议显式设置 AUTH_SECRET。'
    );
  }
  return generated;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private accounts: AgentAccount[] = [];
  private readonly secret = resolveAuthSecret();

  /** 调用时读取，测试可用进程环境变量指向临时目录（构造器保持无参）。 */
  private get dataDir(): string {
    return process.env.DATA_DIR || appConfig.dataDir;
  }

  private toPublic(a: AgentAccount): PublicAgent {
    return {
      id: a.id,
      name: a.name,
      role: a.role === 'admin' ? 'admin' : 'agent',
      active: a.active !== false,
    };
  }

  async onModuleInit() {
    this.accounts = JSON.parse(
      await fs.readFile(path.join(this.dataDir, 'agents.json'), 'utf8')
    );
    if (process.env.NODE_ENV === 'production') {
      const weak = this.accounts.filter((a) => verifyPassword(DEMO_PASSWORD, a.salt, a.passwordHash));
      if (weak.length) {
        const ids = weak.map((a) => a.id).join(', ');
        this.logger.error(
          demoCredentialsAllowed()
            ? `ALLOW_DEMO_CREDENTIALS 已开启，${weak.length} 个账号仍使用已公开的演示口令（${DEMO_PASSWORD}）：${ids}。引导完成后请修改密码并关闭该开关。`
            : `已拒绝 ${weak.length} 个使用已公开演示口令（${DEMO_PASSWORD}）的账号登录：${ids}。生产环境请更换 data/agents.json 的口令；仅在一次性引导时设置 ALLOW_DEMO_CREDENTIALS=true。`
        );
      }
    }
  }

  login(agentNo: string, password: string): { token: string; agent: AuthenticatedAgent } | null {
    const account = this.accounts.find((item) => item.id === String(agentNo || '').trim());
    const plain = String(password || '');
    if (!account || account.active === false || !verifyPassword(plain, account.salt, account.passwordHash)) {
      return null;
    }
    // 演示口令写在仓库和 README 里。生产环境直接拒绝，避免种子管理员被公开密码登录。
    if (plain === DEMO_PASSWORD && !demoCredentialsAllowed()) return null;
    const role: AgentRole = account.role === 'admin' ? 'admin' : 'agent';
    return {
      token: signToken({ sub: account.id, name: account.name, role }, this.secret),
      agent: { id: account.id, name: account.name, role },
    };
  }

  /**
   * 签名只证明令牌没被篡改。每次请求再对照当前账号：已删除或已停用立即失效，
   * 角色和姓名以账号当前值为准，降级后的旧 token 不能继续当 admin。
   */
  private agentFromClaims(claims: { sub: string } | null): AuthenticatedAgent | null {
    if (!claims) return null;
    const account = this.accounts.find((item) => item.id === claims.sub);
    if (!account || account.active === false) return null;
    return {
      id: account.id,
      name: account.name,
      role: account.role === 'admin' ? 'admin' : 'agent',
    };
  }

  verify(token: string): AuthenticatedAgent | null {
    return this.agentFromClaims(verifyToken(token, this.secret));
  }

  // ---------- 账号运营管理（工作台「用户管理」页，仅 admin） ----------

  listAgents(): PublicAgent[] {
    return this.accounts.map((a) => this.toPublic(a));
  }

  private static sanitizeId(id: any): string {
    const v = String(id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(v)) {
      throw new Error('账号 id 非法：3-32 位字母/数字/_/-');
    }
    return v;
  }

  private static sanitizeName(name: any): string {
    const v = String(name ?? '').trim();
    if (!v) throw new Error('姓名不能为空');
    if (v.length > 32) throw new Error('姓名过长（最多 32 字）');
    return v;
  }

  private static sanitizeRole(role: any): AgentRole {
    if (role !== 'admin' && role !== 'agent') throw new Error("role 只能是 'admin' 或 'agent'");
    return role;
  }

  private static sanitizePassword(password: any): string {
    const v = String(password ?? '');
    if (v.length < 6) throw new Error('密码至少 6 位');
    if (v.length > 128) throw new Error('密码过长');
    return v;
  }

  private async persistAgents(): Promise<void> {
    await fs.writeFile(path.join(this.dataDir, 'agents.json'), JSON.stringify(this.accounts, null, 2) + '\n', 'utf8');
  }

  /** 是否还有除 targetId 之外的启用 admin（删账号/降级/停用前的护栏）。 */
  private hasOtherActiveAdmin(targetId: string): boolean {
    return this.accounts.some((a) => a.id !== targetId && a.role === 'admin' && a.active !== false);
  }

  async createAgent(input: any): Promise<PublicAgent> {
    const id = AuthService.sanitizeId(input?.id);
    const name = AuthService.sanitizeName(input?.name);
    const role = AuthService.sanitizeRole(input?.role ?? 'agent');
    const password = AuthService.sanitizePassword(input?.password);
    if (this.accounts.some((a) => a.id === id)) {
      throw new Error('账号 id 已存在');
    }
    const salt = randomBytes(16).toString('hex');
    const account: AgentAccount = {
      id,
      name,
      salt,
      passwordHash: hashPassword(password, salt),
      role,
      active: true,
    };
    this.accounts.push(account);
    await this.persistAgents();
    return this.toPublic(account);
  }

  /**
   * 更新账号。selfId 为操作者本人 id：禁止给自己降级、停用（防锁死）。
   * 返回 null 表示账号不存在。
   */
  async updateAgent(id: string, input: any, selfId?: string): Promise<PublicAgent | null> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return null;
    if (input?.name !== undefined) account.name = AuthService.sanitizeName(input.name);
    if (input?.role !== undefined) {
      const role = AuthService.sanitizeRole(input.role);
      if (role !== account.role) {
        if (id === selfId) throw new Error('不能修改自己的角色');
        if (account.role === 'admin' && role === 'agent' && !this.hasOtherActiveAdmin(id)) {
          throw new Error('不能降级最后一个启用的管理员');
        }
        account.role = role;
      }
    }
    if (input?.password !== undefined && String(input.password) !== '') {
      account.salt = randomBytes(16).toString('hex');
      account.passwordHash = hashPassword(AuthService.sanitizePassword(input.password), account.salt);
    }
    if (input?.active !== undefined) {
      const active = Boolean(input.active);
      if (!active) {
        if (id === selfId) throw new Error('不能停用自己的账号');
        if (account.role === 'admin' && !this.hasOtherActiveAdmin(id)) {
          throw new Error('不能停用最后一个启用的管理员');
        }
      }
      account.active = active;
    }
    await this.persistAgents();
    return this.toPublic(account);
  }

  /**
   * 删除账号。selfId 为操作者本人 id：禁止删自己、删最后一个启用 admin。
   * 返回 false 表示账号不存在。
   */
  async deleteAgent(id: string, selfId?: string): Promise<boolean> {
    const idx = this.accounts.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    if (id === selfId) throw new Error('不能删除自己的账号');
    const account = this.accounts[idx];
    if (account.role === 'admin' && account.active !== false && !this.hasOtherActiveAdmin(id)) {
      throw new Error('不能删除最后一个启用的管理员');
    }
    this.accounts.splice(idx, 1);
    await this.persistAgents();
    return true;
  }

  issueSseTicket(agent: AuthenticatedAgent): string {
    return signSseTicket({ sub: agent.id, name: agent.name, role: agent.role }, this.secret);
  }

  verifySseTicket(ticket: string): AuthenticatedAgent | null {
    return this.agentFromClaims(verifySseTicket(ticket, this.secret));
  }

  /** 为访客签发绑定该 sessionId 的读取凭证（见 visitor-token.ts 的设计说明） */
  issueVisitorToken(sessionId: string): string {
    return signVisitorToken(sessionId, this.secret);
  }

  verifyVisitorToken(token: string | undefined | null, sessionId: string): boolean {
    return verifyVisitorToken(token, sessionId, this.secret);
  }
}
