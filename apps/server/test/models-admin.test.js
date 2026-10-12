import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelSettingsService, isProviderKeyConfigured } from '../dist/ai/model-settings.service.js';
import { AI_PROVIDER_PRESETS } from '../dist/config.js';

async function makeService(settings) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'models-test-'));
  process.env.DATA_DIR = dir;
  if (settings) {
    await fs.writeFile(path.join(dir, 'model-settings.json'), JSON.stringify(settings), 'utf8');
  }
  const svc = new ModelSettingsService();
  await svc.onModuleInit();
  return { svc, dir };
}

async function teardown(svc, dir) {
  svc.onModuleDestroy();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
}

test('文件缺失时回退环境变量推导值', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const s = svc.getSettings();
    assert.ok(AI_PROVIDER_PRESETS[s.defaultProvider]);
    assert.ok(s.defaultModel.length > 0);
    assert.equal(svc.isEnabled('zhipu'), true); // 缺省视为启用
  } finally { await teardown(svc, dir); }
});

test('读取已有设置文件', async () => {
  const { svc, dir } = await makeService({
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    enabled: { zhipu: false },
  });
  try {
    assert.equal(svc.getActiveProvider(), 'deepseek');
    assert.equal(svc.getActiveModel(), 'deepseek-chat');
    assert.equal(svc.isEnabled('zhipu'), false);
    assert.equal(svc.isEnabled('openai'), true);
  } finally { await teardown(svc, dir); }
});

test('更新设置：换厂商时模型跟随预设，写回文件', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const s = await svc.updateSettings({ defaultProvider: 'zhipu' });
    assert.equal(s.defaultProvider, 'zhipu');
    assert.equal(s.defaultModel, 'glm-4.7-flash'); // 跟随预设
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'model-settings.json'), 'utf8'));
    assert.equal(onDisk.defaultProvider, 'zhipu');
    // 显式指定模型则不跟随
    const s2 = await svc.updateSettings({ defaultProvider: 'deepseek', defaultModel: 'deepseek-reasoner' });
    assert.equal(s2.defaultModel, 'deepseek-reasoner');
  } finally { await teardown(svc, dir); }
});

test('更新设置：未知厂商 / 空模型抛错', async () => {
  const { svc, dir } = await makeService(null);
  try {
    await assert.rejects(() => svc.updateSettings({ defaultProvider: 'nope' }), /未知/);
    await assert.rejects(() => svc.updateSettings({ defaultModel: '  ' }), /不能为空/);
    await assert.rejects(() => svc.updateSettings({ enabled: { nope: true } }), /未知/);
    await assert.rejects(() => svc.updateSettings({ enabled: [1] }), /必须是对象/);
  } finally { await teardown(svc, dir); }
});

test('更新开关：enabled 持久化', async () => {
  const { svc, dir } = await makeService(null);
  try {
    await svc.updateSettings({ enabled: { openai: false, zhipu: true } });
    assert.equal(svc.isEnabled('openai'), false);
    assert.equal(svc.isEnabled('zhipu'), true);
  } finally { await teardown(svc, dir); }
});

test('isProviderKeyConfigured：厂商专属变量优先，回退 AI_API_KEY', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.ZHIPU_API_KEY;
    delete process.env.AI_API_KEY;
    assert.equal(isProviderKeyConfigured('zhipu'), false);
    process.env.AI_API_KEY = 'sk-test';
    assert.equal(isProviderKeyConfigured('zhipu'), true);
    assert.equal(isProviderKeyConfigured('nope'), false);
    assert.equal(isProviderKeyConfigured('ollama'), true); // keyOptional 视为已配置
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
