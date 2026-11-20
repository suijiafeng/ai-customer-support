import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoCommerce } from '../dist/agent/commerce.js';

test('A9：会话 ID 末 4 位相同的两个访客，演示订单互不覆盖', () => {
  const commerce = new DemoCommerce();
  const a = commerce.listOrders('v-aaaa1234');
  const b = commerce.listOrders('v-bbbb1234');
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].id, 'DEMO-123401');
  assert.notEqual(b[0].id, a[0].id);
  // A 的订单仍属于 A，B 不能查到也不能改
  assert.equal(commerce.getOrder(a[0].id, 'v-aaaa1234').ok, true);
  assert.equal(commerce.getOrder(a[0].id, 'v-bbbb1234').error, 'forbidden');
  assert.equal(commerce.updateAddress(a[0].id, 'v-bbbb1234', 'x').ok, false);
  // 再查一次不会重新发单
  assert.deepEqual(commerce.listOrders('v-aaaa1234').map((o) => o.id), [a[0].id]);
  assert.deepEqual(commerce.listOrders('v-bbbb1234').map((o) => o.id), [b[0].id]);
});

test('A9：大量访客也不会撞号', () => {
  const commerce = new DemoCommerce();
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(commerce.listOrders(`v-${i}-same`)[0].id);
  assert.equal(ids.size, 500);
});
