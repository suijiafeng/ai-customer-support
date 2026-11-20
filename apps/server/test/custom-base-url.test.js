// A8：AI_BASE_URL 指向非预设的 OpenAI 兼容服务时，必须真的用这个地址和 AI_MODEL，
// 不能被替换成 DeepSeek 预留项（那样 AI_API_KEY 会被发到 api.deepseek.com）。
// appConfig 在 import 时读取环境变量，所以先起 mock、设好 env，再动态 import。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMockOpenAI } from './helpers/mock-openai.js';

const mock = await startMockOpenAI(() => ({ text: '来自自定义接口的回答' }));
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-url-'));
for (const k of ['AI_PROVIDER', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'AI_MODEL']) delete process.env[k];
Object.assign(process.env, {
  AI_ENABLED: 'true',
  AI_BASE_URL: mock.baseUrl,
  AI_MODEL: 'my-local-model',
  AI_API_KEY: 'sk-test-custom',
  DATA_DIR: dataDir,
});
const { resolveAiSettings } = await import('../dist/config.js');
const { ModelSettingsService } = await import('../dist/ai/model-settings.service.js');
const { AiService } = await import('../dist/ai/ai.service.js');

test.after(async () => {
  await mock.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('非预设的 AI_BASE_URL 解析为 custom，而不是域名主体', () => {
  assert.equal(resolveAiSettings({ AI_BASE_URL: 'http://localhost:4010/v1' }).provider, 'custom');
  assert.equal(resolveAiSettings({ AI_BASE_URL: 'https://llm.mycorp.com/v1' }).provider, 'custom');
  // 预设地址仍按预设识别
  assert.equal(resolveAiSettings({ AI_BASE_URL: 'https://api.deepseek.com' }).provider, 'deepseek');
  assert.equal(resolveAiSettings({}).provider, 'openai');
});

test('默认模型就是环境变量里的自定义接口，请求真的打到 AI_BASE_URL', async () => {
  const settings = new ModelSettingsService();
  await settings.onModuleInit();
  try {
    const conn = settings.getActiveConnection();
    assert.equal(conn.provider, 'custom');
    assert.equal(conn.model, 'my-local-model');
    assert.equal(conn.baseUrl, mock.baseUrl);
    assert.equal(conn.apiKey, 'sk-test-custom');

    const ai = new AiService(settings);
    const result = await ai.buildReply({
      message: '你好', history: [], matchedFaqs: [], intent: 'general',
      handoff: { needHuman: false, reason: '' }, inquiry: null, ticket: null,
    });
    assert.equal(result.ai.used, true);
    assert.equal(result.text, '来自自定义接口的回答');
    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].model, 'my-local-model');
  } finally {
    settings.onModuleDestroy();
  }
});
