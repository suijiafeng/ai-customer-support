// 端到端测试用：在子进程里启动编译后的服务（dist/main.js），内存存储，数据目录是临时拷贝。
// 不会改动 apps/server/data，也不会连任何真实模型（AI_BASE_URL 指向测试里起的 mock）。
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function startServer(env = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistflow-e2e-'));
  const srcData = path.join(serverRoot, 'data');
  for (const name of await fs.readdir(srcData)) {
    if (name.endsWith('.json') || name.endsWith('.txt')) {
      if (name === 'model-settings.json') continue;
      await fs.copyFile(path.join(srcData, name), path.join(dataDir, name));
    }
  }
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(serverRoot, 'dist', 'main.js')], {
    cwd: serverRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      PORT: String(port),
      DB_DRIVER: 'memory',
      DATA_DIR: dataDir,
      AUTH_SECRET: 'e2e-secret',
      ALLOW_DEMO_CREDENTIALS: 'true',
      DEMO_ENABLED: 'false',
      WIDGET_ENABLED: 'false',
      WORKSTATION_ENABLED: 'false',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {}
    if (Date.now() - started > 15000) {
      child.kill();
      throw new Error(`server did not start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const request = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json, data: json?.data ?? json };
  };

  const login = await request('POST', '/api/auth/login', { agentNo: '9527', password: '123456' });
  const agentToken = login.data.token;
  const siteKey = `e2e-${Date.now()}`;
  const created = await request('POST', '/api/widget-keys', { key: siteKey, name: 'e2e' }, { authorization: `Bearer ${agentToken}` });
  const tenantId = created.data.key.id;

  return {
    base,
    agentToken,
    siteKey,
    tenantId,
    output: () => output,
    request,
    chat: (sessionId, message, extra = {}, headers = {}) =>
      request('POST', '/api/chat', { sessionId, message, siteKey, tenantId, ...extra }, headers),
    detail: (sessionId) => request('GET', `/api/sessions/${sessionId}`, undefined, { authorization: `Bearer ${agentToken}` }),
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
