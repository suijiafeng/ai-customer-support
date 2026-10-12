import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ModelSettingsService, isProviderKeyConfigured, keySourceOf, maskKey, RESERVED_DEEPSEEK_ID,
} from '../dist/ai/model-settings.service.js';

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

async function readDisk(dir) {
  return JSON.parse(await fs.readFile(path.join(dir, 'model-settings.json'), 'utf8'));
}

test('文件缺失时预置 DeepSeek 模型', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const models = svc.listModels();
    const ds = models.find((m) => m.id === RESERVED_DEEPSEEK_ID);
    assert.ok(ds, '应预置 DeepSeek');
    assert.equal(ds.provider, 'deepseek');
    assert.equal(ds.enabled, true);
    // 默认模型一定存在且启用
    const def = models.find((m) => m.id === svc.getDefaultId());
    assert.ok(def && def.enabled);
  } finally { await teardown(svc, dir); }
});

test('旧格式 v1 迁移：DeepSeek 默认 → 单条 DeepSeek，沿用旧模型 ID', async () => {
  const { svc, dir } = await makeService({
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-reasoner',
    enabled: { zhipu: false },
  });
  try {
    const models = svc.listModels();
    assert.equal(models.length, 1);
    assert.equal(svc.getActiveProvider(), 'deepseek');
    assert.equal(svc.getActiveModel(), 'deepseek-reasoner');
  } finally { await teardown(svc, dir); }
});

test('旧格式 v1 迁移：其他厂商默认 → 保留 DeepSeek，并以旧厂商为默认', async () => {
  const { svc, dir } = await makeService({ defaultProvider: 'zhipu', defaultModel: 'glm-4.6', enabled: {} });
  try {
    const models = svc.listModels();
    assert.equal(models.length, 2);
    assert.ok(models.some((m) => m.id === RESERVED_DEEPSEEK_ID));
    assert.equal(svc.getActiveProvider(), 'zhipu');
    assert.equal(svc.getActiveModel(), 'glm-4.6');
  } finally { await teardown(svc, dir); }
});

test('新增模型：模型 ID 缺省跟随厂商预设，写回文件', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const m = await svc.createModel({ provider: 'zhipu', name: '智谱快速' });
    assert.equal(m.model, 'glm-4.7-flash');
    assert.equal(m.name, '智谱快速');
    assert.equal(m.enabled, true);
    const disk = await readDisk(dir);
    assert.ok(disk.models.some((x) => x.id === m.id));
  } finally { await teardown(svc, dir); }
});

test('新增模型：未知厂商 / 自定义缺地址 / 非法地址 抛错', async () => {
  const { svc, dir } = await makeService(null);
  try {
    await assert.rejects(() => svc.createModel({ provider: 'nope' }), /未知的厂商/);
    await assert.rejects(() => svc.createModel({ provider: 'custom', model: 'x' }), /接口地址/);
    await assert.rejects(() => svc.createModel({ provider: 'openai', baseUrl: 'ftp://x' }), /http/);
    await assert.rejects(() => svc.createModel({ provider: 'openai', baseUrl: 'not a url' }), /格式/);
  } finally { await teardown(svc, dir); }
});

test('编辑模型：空 Key 不覆盖已有 Key，clearApiKey 才清空', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const m = await svc.createModel({ provider: 'openai', apiKey: 'sk-abcdef1234' });
    assert.equal(keySourceOf(m), 'custom');
    assert.equal(maskKey(m.apiKey), '••••1234');
    const kept = await svc.updateModel(m.id, { apiKey: '', model: 'gpt-4.1' });
    assert.equal(kept.apiKey, 'sk-abcdef1234');
    assert.equal(kept.model, 'gpt-4.1');
    const cleared = await svc.updateModel(m.id, { clearApiKey: true });
    assert.equal(cleared.apiKey, '');
  } finally { await teardown(svc, dir); }
});

test('只剩一个模型时不能删除', async () => {
  const { svc, dir } = await makeService(null);
  try {
    // 保证只有一条
    for (const m of svc.listModels()) {
      if (m.id !== svc.getDefaultId()) await svc.deleteModel(m.id);
    }
    assert.equal(svc.listModels().length, 1);
    await assert.rejects(() => svc.deleteModel(svc.getDefaultId()), /至少需要保留一个模型/);
  } finally { await teardown(svc, dir); }
});

test('默认模型不能删除、不能停用；切换默认后可删除原默认', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const oldDefault = svc.getDefaultId();
    const extra = await svc.createModel({ provider: 'qwen' });
    await assert.rejects(() => svc.deleteModel(oldDefault), /默认模型不能删除/);
    await assert.rejects(() => svc.updateModel(oldDefault, { enabled: false }), /默认模型不能停用/);

    await svc.setDefault(extra.id);
    assert.equal(svc.getActiveProvider(), 'qwen');
    await svc.deleteModel(oldDefault);
    assert.ok(!svc.listModels().some((m) => m.id === oldDefault));
  } finally { await teardown(svc, dir); }
});

test('停用的模型不能设为默认；不存在的模型报错', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const m = await svc.createModel({ provider: 'moonshot', enabled: false });
    await assert.rejects(() => svc.setDefault(m.id), /请先启用/);
    await assert.rejects(() => svc.updateModel('mdl_missing', { name: 'x' }), /模型不存在/);
    await assert.rejects(() => svc.deleteModel('mdl_missing'), /模型不存在/);
  } finally { await teardown(svc, dir); }
});

test('生效连接：专属 Key / 自定义地址优先，否则回退预设', async () => {
  const { svc, dir } = await makeService(null);
  try {
    const m = await svc.createModel({
      provider: 'custom', baseUrl: 'https://llm.example.com/v1', model: 'my-model', apiKey: 'sk-own-9999',
    });
    await svc.setDefault(m.id);
    const conn = svc.getActiveConnection();
    assert.equal(conn.baseUrl, 'https://llm.example.com/v1');
    assert.equal(conn.apiKey, 'sk-own-9999');
    assert.equal(conn.model, 'my-model');

    const z = await svc.createModel({ provider: 'zhipu' });
    await svc.setDefault(z.id);
    assert.equal(svc.getActiveConnection().baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
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
