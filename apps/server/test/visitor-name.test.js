// 访客展示名：工作台列表、聊天头部、消息气泡统一使用 @assistflow/shared 的短码规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorDisplayName, shortVisitorCode } from '@assistflow/shared';

test('自动生成的「访客 v-…」缩短为末 4 位大写短码', () => {
  assert.equal(visitorDisplayName('访客 v-d06f1d90e0fa440db5'), '访客 0DB5');
  assert.equal(shortVisitorCode('v-d06f1d90e0fa440db5'), '0DB5');
});

test('访客自己留的名字原样显示', () => {
  assert.equal(visitorDisplayName('张三'), '张三');
});

test('非 v- 开头的长标识首尾保留、中间省略', () => {
  assert.equal(shortVisitorCode('custom-visitor-identifier-123'), 'custom…-123');
  assert.equal(shortVisitorCode('short'), 'short');
});
