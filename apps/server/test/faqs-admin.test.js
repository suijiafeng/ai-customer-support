import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeService } from '../dist/knowledge/knowledge.service.js';

async function makeService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'faq-test-'));
  process.env.DATA_DIR = dir;
  await fs.writeFile(path.join(dir, 'faqs.json'), JSON.stringify([
    { id: 'a1', question: '怎么收费？', answer: '按项目报价', keywords: ['收费', '价格'], intent: 'pricing' },
    { id: 'a2', question: '支持退款吗？', answer: '支持', keywords: ['退款'], intent: 'sales' },
  ]), 'utf8');
  await fs.writeFile(path.join(dir, 'inquiries.json'), '[]', 'utf8');
  await fs.writeFile(path.join(dir, 'small-talk.json'), '[]', 'utf8');
  const svc = new KnowledgeService();
  await svc.onModuleInit();
  return { svc, dir };
}

async function teardown(svc, dir) {
  svc.onModuleDestroy();
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
}

test('创建 FAQ：自动生成 id，写回文件并重建索引', async () => {
  const { svc, dir } = await makeService();
  try {
    const faq = await svc.createFaq({ question: '能开发票吗？', answer: '可以', keywords: ['发票'] });
    assert.match(faq.id, /^faq_[0-9a-f]{8}$/);
    assert.equal(faq.question, '能开发票吗？');
    // 文件已写回
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'faqs.json'), 'utf8'));
    assert.equal(onDisk.length, 3);
    // 索引已重建：能搜到
    assert.equal(svc.searchFaqsAdmin('发票').length, 1);
  } finally { await teardown(svc, dir); }
});

test('创建 FAQ：question 为空时抛错，不写文件', async () => {
  const { svc, dir } = await makeService();
  try {
    await assert.rejects(() => svc.createFaq({ question: '  ', answer: 'x' }), /question 不能为空/);
    assert.equal(svc.faqs.length, 2);
  } finally { await teardown(svc, dir); }
});

test('更新 FAQ：不存在返回 null；存在则更新并持久化', async () => {
  const { svc, dir } = await makeService();
  try {
    assert.equal(await svc.updateFaq('nope', { question: 'x', answer: 'y' }), null);
    const updated = await svc.updateFaq('a1', { answer: '按人天报价', keywords: ['收费', '人天', '收费'] });
    assert.equal(updated.answer, '按人天报价');
    assert.deepEqual(updated.keywords, ['收费', '人天']); // 去重
    assert.equal(updated.id, 'a1'); // id 不可改
  } finally { await teardown(svc, dir); }
});

test('删除 FAQ：不存在返回 false', async () => {
  const { svc, dir } = await makeService();
  try {
    assert.equal(await svc.deleteFaq('nope'), false);
    assert.equal(await svc.deleteFaq('a2'), true);
    assert.equal(svc.faqs.length, 1);
  } finally { await teardown(svc, dir); }
});

test('运营搜索：q 模糊匹配问题与关键词，intent 精确筛选', async () => {
  const { svc, dir } = await makeService();
  try {
    assert.equal(svc.searchFaqsAdmin('收费').length, 1);
    assert.equal(svc.searchFaqsAdmin('价格').length, 1); // 关键词命中
    assert.equal(svc.searchFaqsAdmin('', 'sales').length, 1);
    assert.equal(svc.searchFaqsAdmin('', 'nope').length, 0);
  } finally { await teardown(svc, dir); }
});

test('导入：merge 按 id upsert，replace 整包替换', async () => {
  const { svc, dir } = await makeService();
  try {
    await svc.importFaqs([
      { id: 'a1', question: '怎么收费？', answer: '更新后的回答' },
      { question: '新问题', answer: '新回答' },
    ], 'merge');
    assert.equal(svc.faqs.length, 3);
    assert.equal(svc.faqs.find((f) => f.id === 'a1').answer, '更新后的回答');
    await svc.importFaqs([{ question: '只剩一条', answer: 'y' }], 'replace');
    assert.equal(svc.faqs.length, 1);
    assert.equal(svc.faqs[0].question, '只剩一条');
  } finally { await teardown(svc, dir); }
});

test('导入：非数组抛错', async () => {
  const { svc, dir } = await makeService();
  try {
    await assert.rejects(() => svc.importFaqs({}), /必须是数组/);
  } finally { await teardown(svc, dir); }
});
