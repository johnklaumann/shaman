import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, runCheck, esmToCjs } from '../bench/checks.mjs';

// Self-test for the live-ab2 correctness gates, run before any API spend:
// every gate must be satisfiable by a minimal reference implementation, and
// must fail a deliberately broken one. A gate that nothing can pass (or that
// passes anything) would silently corrupt the benchmark.

const REFERENCE = {
  's-debounce': `
function debounce(fn, waitMs) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), waitMs); };
}
module.exports = { debounce };`,

  's-retry': `
async function retry(fn, attempts, delayMs) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { err = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs)); }
  }
  throw err;
}
module.exports = { retry };`,

  's-flatten': `
const flatten = (arr) => arr.reduce((f, x) => f.concat(Array.isArray(x) ? flatten(x) : x), []);
module.exports = { flatten };`,

  's-config': `
const fs = require('node:fs');
function readConfig(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
module.exports = { readConfig };`,

  'm-lru': `
class LRU {
  constructor(capacity) { this.cap = capacity; this.m = new Map(); }
  get(k) { if (!this.m.has(k)) return undefined; const v = this.m.get(k); this.m.delete(k); this.m.set(k, v); return v; }
  set(k, v) { this.m.delete(k); this.m.set(k, v); if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value); }
}
module.exports = { LRU };`,

  'm-ratelimit': `
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= limit) { hits.set(key, list); return false; }
      list.push(now); hits.set(key, list); return true;
    },
  };
}
module.exports = { createRateLimiter };`,

  'm-argparse': `
function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq === -1) out[a.slice(2)] = true;
      else out[a.slice(2, eq)] = a.slice(eq + 1);
    } else out._.push(a);
  }
  return out;
}
module.exports = { parseArgs };`,

  'm-csvparse': `
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}
module.exports = { parseCsvLine };`,

  'm-deepmerge': `
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
module.exports = { deepMerge };`,

  'm-emitter': `
class EventEmitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { (this.h.get(ev) || this.h.set(ev, []).get(ev)).push(fn); }
  off(ev, fn) { this.h.set(ev, (this.h.get(ev) || []).filter((f) => f !== fn && f.orig !== fn)); }
  once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; w.orig = fn; this.on(ev, w); }
  emit(ev, ...args) { for (const fn of [...(this.h.get(ev) || [])]) fn(...args); }
}
module.exports = { EventEmitter };`,

  'l-todo': `
function createTodoStore() {
  const todos = new Map();
  let nextId = 1;
  const mustGet = (id) => { if (!todos.has(id)) throw new Error('unknown todo id: ' + id); return todos.get(id); };
  return {
    add({ title } = {}) {
      if (typeof title !== 'string' || !title.trim()) throw new Error('title must be a non-empty string');
      const todo = { id: nextId++, title: title.trim(), done: false };
      todos.set(todo.id, todo);
      return todo;
    },
    list: () => [...todos.values()],
    complete(id) { mustGet(id).done = true; },
    remove(id) { mustGet(id); todos.delete(id); },
  };
}
module.exports = { createTodoStore };`,

  'l-mdtable': `
function mdTable(rows) {
  const esc = (v) => String(v).replace(/\\|/g, '\\\\|');
  const keys = Object.keys(rows[0]);
  const line = (cells) => '| ' + cells.join(' | ') + ' |';
  return [line(keys), line(keys.map(() => '---')), ...rows.map((r) => line(keys.map((k) => esc(r[k]))))].join('\\n');
}
module.exports = { mdTable };`,

  'l-configloader': `
const fs = require('node:fs');
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
}
function loadConfig({ defaults = {}, filePath, env = {}, envPrefix = '' }) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  const out = { ...defaults, ...file };
  const keyMap = new Map(Object.keys(out).map((k) => [k.toLowerCase(), k]));
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith(envPrefix)) continue;
    const bare = k.slice(envPrefix.length).toLowerCase();
    out[keyMap.get(bare) || bare] = coerce(v);
  }
  return out;
}
module.exports = { loadConfig };`,

  'l-statemachine': `
function createMachine({ initial, states }) {
  return {
    state: initial,
    send(event) {
      const next = states[this.state]?.on?.[event];
      if (next) this.state = next;
    },
  };
}
module.exports = { createMachine };`,
};

test('every live-ab2 gate has a reference implementation and vice versa', () => {
  assert.deepEqual(Object.keys(CHECKS).sort(), Object.keys(REFERENCE).sort());
});

for (const [id, code] of Object.entries(REFERENCE)) {
  test(`gate ${id} passes its reference implementation`, () => {
    const r = runCheck(id, code);
    assert.ok(r.pass, `reference for ${id} failed: ${r.reason}`);
  });
}

test('gates can fail: a broken flatten is rejected with a reason', () => {
  const r = runCheck('s-flatten', 'module.exports = { flatten: (a) => a };');
  assert.equal(r.pass, false);
  assert.ok(r.reason.length > 0);
});

test('gates reject empty output', () => {
  assert.equal(runCheck('s-retry', '   ').pass, false);
});

test('esm output is normalized: export function passes the gate', () => {
  const esm = 'export function flatten(a) { return a.reduce((f, x) => f.concat(Array.isArray(x) ? flatten(x) : x), []); }';
  const r = runCheck('s-flatten', esm);
  assert.ok(r.pass, `esm-shimmed flatten failed: ${r.reason}`);
});

test('a trailing demo call after a named function expression does not fail the gate', () => {
  const code = `module.exports.flatten = function flatten(a) { return a.reduce((f, x) => f.concat(Array.isArray(x) ? flatten(x) : x), []); };

flatten([1, [2, [3]]]); // demo call — no top-level binding, would throw at require`;
  const r = runCheck('s-flatten', code);
  assert.ok(r.pass, `demo-call crash must not fail a correct implementation: ${r.reason}`);
});

test('the try/catch wrap does not rescue a genuinely broken implementation', () => {
  const r = runCheck('s-flatten', 'module.exports = { flatten: (a) => a };\nflatten([1]);');
  assert.equal(r.pass, false);
});

test('esmToCjs handles const, class, and export lists; leaves cjs untouched', () => {
  const out = esmToCjs('export const a = 1;\nexport class B {}\nconst c = 3;\nexport { c };');
  assert.match(out, /module\.exports = Object\.assign/);
  assert.match(out, /\ba, B, c\b|\bB\b/);
  const cjs = 'module.exports = { x: 1 };';
  assert.equal(esmToCjs(cjs), cjs);
});
