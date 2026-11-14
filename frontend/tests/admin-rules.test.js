import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminBase, adminRoutes } from '../src/js/pages/admin-rules.js';

const PATH = '/k3Zq8vT1xY7mB4nW9cR2dF6h';

test('an administrator gets the path the backend gave them', () => {
  assert.equal(adminBase({ role: 'ADMIN', adminPath: PATH }), PATH);
  assert.deepEqual(adminRoutes(PATH), { home: PATH, bugs: `${PATH}/bugs` });
});

test('nobody else has a console, even with a path in their stored session', () => {
  assert.equal(adminBase(null), null);
  assert.equal(adminBase({ role: 'USER' }), null);
  assert.equal(adminBase({ role: 'USER', adminPath: PATH }), null);
});

test('an administrator with no path yet (an older session) has no console until /auth/me fills it in', () => {
  assert.equal(adminBase({ role: 'ADMIN' }), null);
});

test('a path that is not the promised shape is refused: never /admin, never another page', () => {
  for (const adminPath of ['/admin', '/dashboard', '/', 'k3Zq8vT1xY7mB4nW9cR2dF6h', `${PATH}/bugs`, `/${'a'.repeat(65)}`, 42]) {
    assert.equal(adminBase({ role: 'ADMIN', adminPath }), null, String(adminPath));
  }
});
