import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStore } = require('../lib/store.js');
const { validateNotePayload } = require('../lib/validate.js');

test('store adds and lists notes', () => {
  const s = createStore();
  const n = s.add({ title: 'hello', body: 'world' });
  assert.equal(n.id, 1);
  assert.equal(s.list().length, 1);
  assert.equal(s.get(1).title, 'hello');
  assert.equal(s.get(999), null);
});

test('store rejects empty titles', () => {
  const s = createStore();
  assert.throws(() => s.add({ title: '' }));
  assert.throws(() => s.add({ title: '   ' }));
  assert.throws(() => s.add({}));
});

test('payload validation reports errors', () => {
  assert.equal(validateNotePayload({ title: 'ok' }).length, 0);
  assert.ok(validateNotePayload({}).length > 0);
  assert.ok(validateNotePayload({ title: 'ok', body: 42 }).length > 0);
});
