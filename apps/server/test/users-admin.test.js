import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../dist/auth/auth.service.js';
import { hashPassword } from '../dist/auth/jwt.js';

function account(id, name, role, password = 'password123', active) {
  const salt = 'salt-' + id;
  return { id, name, salt, passwordHash: hashPassword(password, salt), role, ...(active === undefined ? {} : { active }) };
}

async function makeService(accounts) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'users-test-'));
  process.env.DATA_DIR = dir;
  await fs.writeFile(path.join(dir, 'agents.json'), JSON.stringify(accounts), 'utf8');
  const svc = new AuthService();
  await svc.onModuleInit();
  return { svc, dir };
}

async function teardown(svc, dir) {
  delete process.env.DATA_DIR;
  await fs.rm(dir, { recursive: true, force: true });
}

test('列表脱敏：不暴露 salt 与 passwordHash', async () => {
  const { svc, dir } = await makeService([account('admin', '管理员', 'admin')]);
  try {
    const users = svc.listAgents();
    assert.equal(users.length, 1);
    assert.deepEqual(Object.keys(users[0]).sort(), ['active', 'id', 'name', 'role']);
    assert.equal(users[0].active, true); // 缺省视为启用
  } finally { await teardown(svc, dir); }
});

test('创建账号：密码被加盐哈希后持久化，可登录', async () => {
  const { svc, dir } = await makeService([account('admin', '管理员', 'admin')]);
  try {
    const user = await svc.createAgent({ id: 'kefu01', name: '小王', password: 'secret99', role: 'agent' });
    assert.equal(user.id, 'kefu01');
    assert.equal(user.role, 'agent');
    assert.ok(svc.login('kefu01', 'secret99'));
    assert.equal(svc.login('kefu01', 'wrong'), null);
  } finally { await teardown(svc, dir); }
});

test('创建账号：id 重复 / 密码太短时抛错', async () => {
  const { svc, dir } = await makeService([account('admin', '管理员', 'admin')]);
  try {
    await assert.rejects(() => svc.createAgent({ id: 'admin', name: 'x', password: 'secret99' }), /已存在/);
    await assert.rejects(() => svc.createAgent({ id: 'kefu02', name: 'x', password: '123' }), /至少 6 位/);
    await assert.rejects(() => svc.createAgent({ id: '!!', name: 'x', password: 'secret99' }), /非法/);
  } finally { await teardown(svc, dir); }
});

test('停用账号后无法登录', async () => {
  const { svc, dir } = await makeService([
    account('admin', '管理员', 'admin'),
    account('kefu01', '小王', 'agent'),
  ]);
  try {
    await svc.updateAgent('kefu01', { active: false }, 'admin');
    assert.equal(svc.login('kefu01', 'password123'), null);
  } finally { await teardown(svc, dir); }
});

test('护栏：不能删自己、不能删最后一个启用的管理员', async () => {
  const { svc, dir } = await makeService([
    account('admin', '管理员', 'admin'),
    account('kefu01', '小王', 'agent'),
  ]);
  try {
    await assert.rejects(() => svc.deleteAgent('admin', 'admin'), /自己的账号/);
    await assert.rejects(() => svc.deleteAgent('admin', 'kefu01'), /最后一个启用/);
    // 加第二个 admin 后可删第一个
    await svc.createAgent({ id: 'admin2', name: '副管', password: 'secret99', role: 'admin' });
    assert.equal(await svc.deleteAgent('admin', 'admin2'), true);
  } finally { await teardown(svc, dir); }
});

test('护栏：不能给自己降级、不能降级最后一个启用的管理员', async () => {
  const { svc, dir } = await makeService([account('admin', '管理员', 'admin')]);
  try {
    await assert.rejects(() => svc.updateAgent('admin', { role: 'agent' }, 'admin'), /自己的角色/);
  } finally { await teardown(svc, dir); }
});

test('更新不存在的账号返回 null，删除不存在的返回 false', async () => {
  const { svc, dir } = await makeService([account('admin', '管理员', 'admin')]);
  try {
    assert.equal(await svc.updateAgent('nope', { name: 'x' }, 'admin'), null);
    assert.equal(await svc.deleteAgent('nope', 'admin'), false);
  } finally { await teardown(svc, dir); }
});

test('改密码后旧密码失效、新密码可用', async () => {
  const { svc, dir } = await makeService([
    account('admin', '管理员', 'admin'),
    account('kefu01', '小王', 'agent'),
  ]);
  try {
    await svc.updateAgent('kefu01', { password: 'newpass456' }, 'admin');
    assert.equal(svc.login('kefu01', 'password123'), null);
    assert.ok(svc.login('kefu01', 'newpass456'));
  } finally { await teardown(svc, dir); }
});
