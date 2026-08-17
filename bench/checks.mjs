// Correctness gates for live-ab2: each task id maps to an assert script that
// runs against the model's extracted code (required as ./impl.cjs). A tier
// upgrade in shaman is only a win if the smaller code still passes — fewer
// lines that fail the gate count as a loss, not a saving.
//
// Scripts run in a child node process with a hard timeout; process.exit(0) =
// pass. Asserts are deliberately adversarial where it matters (quoted CSV,
// eviction order, per-key isolation, invalid input). tests/checks.test.mjs
// proves every gate is satisfiable by a reference implementation and can fail
// a broken one — the self-test runs before any API spend.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runner prelude: assert + sleep + a tolerant export resolver. pick() tries the
// contract names first, then module.exports itself if it is the function — both
// arms get the same tolerance, so neither is penalized for export style.
export const PRELUDE = `'use strict';
const assert = require('node:assert/strict');
const impl = require('./impl.cjs');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
function pick(mod, ...names) {
  for (const n of names) {
    if (mod && typeof mod[n] === 'function') return mod[n];
    const hit = mod && Object.keys(mod).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit && typeof mod[hit] === 'function') return mod[hit];
  }
  if (typeof mod === 'function') return mod;
  throw new Error('export not found: ' + names.join('|') + ' (have: ' + Object.keys(mod || {}).join(',') + ')');
}
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e && e.message); process.exit(1); });
`;

// Models sometimes ignore the module.exports contract and emit ESM syntax.
// Loading that in impl.cjs fails for reasons that have nothing to do with the
// logic under test, so normalize the common ESM shapes to CJS. Applied to both
// arms — neither is penalized for export ceremony.
export function esmToCjs(code) {
  if (!/^\s*export\b/m.test(code)) return code;
  const names = [];
  let out = code
    .replace(/^\s*export\s+default\s+/m, 'module.exports = ')
    .replace(/^(\s*)export\s+(async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)/gm,
      (_, ind, asy, kw, name) => { names.push(name); return `${ind}${asy || ''}${kw} ${name}`; })
    .replace(/^(\s*)export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
      (_, ind, kw, name) => { names.push(name); return `${ind}${kw} ${name}`; })
    .replace(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm, (_, list) => {
      for (const part of list.split(',')) {
        const name = part.split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
      return '';
    });
  if (names.length) out += `\nmodule.exports = Object.assign(module.exports || {}, { ${[...new Set(names)].join(', ')} });`;
  return out;
}

// Models often append a bare demo call after `module.exports.f = function f()`;
// a named function expression creates no top-level binding, so the demo throws
// at require() time and would fail code whose implementation is fine. Wrapping
// the module body in try/catch keeps every export assigned before the crash;
// a genuinely broken implementation still fails because pick() finds nothing.
// Applied to both arms identically.
const wrapImpl = (code) => `try {\n${code}\n} catch (_demoCrash) {}\n`;

function failReason(stderr) {
  const lines = (stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.find((l) => /Error|assert|not a function|not defined/.test(l));
  return (err || lines[0] || 'nonzero exit').slice(0, 160);
}

export function runCheck(taskId, code) {
  if (!code.trim()) return { pass: false, reason: 'no code block emitted' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'impl.cjs'), wrapImpl(esmToCjs(code)));
    fs.writeFileSync(path.join(dir, 'runner.cjs'), PRELUDE + CHECKS[taskId]);
    const r = spawnSync('node', ['runner.cjs'], { cwd: dir, encoding: 'utf8', timeout: 8000 });
    if (r.status === 0) return { pass: true, reason: '' };
    return { pass: false, reason: r.error?.message ? r.error.message.slice(0, 160) : failReason(r.stderr) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const CHECKS = {
  's-debounce': `
(async () => {
  const debounce = pick(impl, 'debounce');
  let calls = 0;
  const d = debounce(() => calls++, 40);
  d(); d(); d();
  await sleep(120);
  assert.equal(calls, 1, 'three rapid calls must collapse to one');
  d();
  await sleep(120);
  assert.equal(calls, 2, 'a later call fires again');
  process.exit(0);
})();`,

  's-retry': `
(async () => {
  const retry = pick(impl, 'retry');
  let n = 0;
  const ok = await retry(() => { n++; return n < 3 ? Promise.reject(new Error('boom')) : Promise.resolve('done'); }, 5, 5);
  assert.equal(ok, 'done');
  assert.equal(n, 3, 'succeeds on 3rd attempt: exactly 3 calls');
  let m = 0;
  await assert.rejects(() => retry(() => { m++; return Promise.reject(new Error('always')); }, 3, 5));
  assert.ok(m >= 3, 'exhausts all attempts before rejecting');
  process.exit(0);
})();`,

  's-flatten': `
const flatten = pick(impl, 'flatten');
assert.deepEqual(flatten([1, [2, [3, [4, [5]]]], 6]), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(flatten([]), []);
assert.deepEqual(flatten([[], [[]], 1]), [1]);
process.exit(0);`,

  's-config': `
const readConfig = pick(impl, 'readConfig');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const p = path.join(os.tmpdir(), 'shaman-check-' + process.pid + '.json');
fs.writeFileSync(p, JSON.stringify({ port: 8080 }));
const r1 = readConfig(p);
assert.equal(r1.port, 8080, 'reads existing file');
const r2 = readConfig(p + '.missing');
assert.deepEqual(r2, {}, 'missing file falls back to {}');
fs.unlinkSync(p);
process.exit(0);`,

  'm-lru': `
const LRU = pick(impl, 'LRU', 'LRUCache', 'createLRU');
const c = LRU.prototype ? new LRU(2) : LRU(2);
c.set('a', 1); c.set('b', 2);
assert.equal(c.get('a'), 1, 'get(a) after set');
c.set('c', 3); // capacity 2: least-recently-used is b (a was just read)
assert.equal(c.get('b'), undefined, 'b evicted — a was more recently used');
assert.equal(c.get('a'), 1);
assert.equal(c.get('c'), 3);
process.exit(0);`,

  'm-ratelimit': `
const make = pick(impl, 'createRateLimiter', 'rateLimiter', 'RateLimiter');
const lim = make.prototype ? new make({ limit: 3, windowMs: 60000 }) : make({ limit: 3, windowMs: 60000 });
const allow = (k) => (lim.allow ? lim.allow(k) : lim.check ? lim.check(k) : lim(k));
assert.equal(allow('ip1'), true);
assert.equal(allow('ip1'), true);
assert.equal(allow('ip1'), true);
assert.equal(allow('ip1'), false, '4th request in window must be denied');
assert.equal(allow('ip2'), true, 'other keys are isolated — one client cannot exhaust another');
process.exit(0);`,

  'm-argparse': `
const parseArgs = pick(impl, 'parseArgs', 'parse');
const r = parseArgs(['build', '--verbose', '--out=dist', 'src']);
assert.equal(r.verbose, true, '--verbose is a boolean flag');
assert.equal(r.out, 'dist', '--out=dist splits on =');
const pos = r._ || r.positionals || r.args;
assert.ok(pos && pos.includes('build') && pos.includes('src'), 'positionals collected');
process.exit(0);`,

  'm-csvparse': `
const parseCsvLine = pick(impl, 'parseCsvLine', 'parseCSVLine', 'parseCsv', 'parseLine');
assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd'], 'quoted field keeps its comma');
assert.deepEqual(parseCsvLine('x,"he said ""hi""",z'), ['x', 'he said "hi"', 'z'], 'RFC 4180 escaped quotes');
assert.deepEqual(parseCsvLine('a,,c'), ['a', '', 'c'], 'empty field preserved');
process.exit(0);`,

  'm-deepmerge': `
const deepMerge = pick(impl, 'deepMerge', 'merge');
assert.deepEqual(deepMerge({ a: { x: 1 }, b: 1 }, { a: { y: 2 }, b: 2 }), { a: { x: 1, y: 2 }, b: 2 });
assert.deepEqual(deepMerge({ l: [1, 2] }, { l: [3] }), { l: [3] }, 'arrays replace, not concat');
const base = { a: { x: 1 } };
deepMerge(base, { a: { y: 2 } });
assert.deepEqual(base, { a: { x: 1 } }, 'inputs are not mutated');
process.exit(0);`,

  'm-emitter': `
const E = pick(impl, 'EventEmitter', 'Emitter', 'createEmitter');
const e = E.prototype ? new E() : E();
let hits = 0, payload = null;
const h = (x) => { hits++; payload = x; };
e.on('ev', h);
e.emit('ev', 42);
assert.equal(hits, 1); assert.equal(payload, 42, 'emit passes args');
e.off('ev', h);
e.emit('ev', 1);
assert.equal(hits, 1, 'off removes the handler');
let onceHits = 0;
e.once('one', () => onceHits++);
e.emit('one'); e.emit('one');
assert.equal(onceHits, 1, 'once fires exactly once');
process.exit(0);`,

  'l-todo': `
const createTodoStore = pick(impl, 'createTodoStore', 'TodoStore');
const s = createTodoStore.prototype ? new createTodoStore() : createTodoStore();
const t1 = s.add({ title: 'buy milk' });
assert.ok(t1.id !== undefined, 'add returns the todo with an id');
assert.equal(t1.done, false, 'new todos start not done');
const t2 = s.add({ title: 'ship v2' });
assert.equal(s.list().length, 2);
s.complete(t1.id);
assert.equal(s.list().find((t) => t.id === t1.id).done, true, 'complete marks done');
assert.throws(() => s.add({ title: '' }), 'empty title must be rejected');
assert.throws(() => s.complete('nope-' + Math.max()), 'unknown id must be rejected');
s.remove ? s.remove(t2.id) : s.delete(t2.id);
assert.equal(s.list().length, 1, 'delete removes');
process.exit(0);`,

  'l-mdtable': `
const mdTable = pick(impl, 'mdTable', 'markdownTable', 'toMarkdownTable');
const out = mdTable([{ name: 'a|b', n: 1 }, { name: 'plain', n: 22 }]);
const lines = out.trim().split('\\n');
assert.ok(lines[0].includes('name') && lines[0].includes('n'), 'header row from keys');
assert.ok(/\\|\\s*-+/.test(lines[1]), 'separator row');
assert.ok(out.includes('a\\\\|b') || out.includes('a&#124;b'), 'pipe inside a cell is escaped');
assert.equal(lines.length, 4, 'header + separator + 2 rows');
process.exit(0);`,

  'l-configloader': `
const loadConfig = pick(impl, 'loadConfig');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const p = path.join(os.tmpdir(), 'shaman-cfg-' + process.pid + '.json');
fs.writeFileSync(p, JSON.stringify({ port: 9000, debug: false }));
const cfg = loadConfig({
  defaults: { port: 3000, debug: false, name: 'app' },
  filePath: p,
  env: { APP_PORT: '8080', APP_DEBUG: 'true' },
  envPrefix: 'APP_',
});
assert.equal(cfg.name, 'app', 'defaults survive');
assert.equal(cfg.port, 8080, 'env beats file: coerced to number');
assert.equal(cfg.debug, true, 'env "true" coerced to boolean');
const cfg2 = loadConfig({ defaults: { port: 3000 }, filePath: p + '.missing', env: {}, envPrefix: 'APP_' });
assert.equal(cfg2.port, 3000, 'missing file falls back to defaults');
fs.unlinkSync(p);
process.exit(0);`,

  'l-statemachine': `
const createMachine = pick(impl, 'createMachine', 'StateMachine');
const m = createMachine.prototype ? new createMachine({
  initial: 'idle',
  states: { idle: { on: { START: 'running' } }, running: { on: { STOP: 'idle', PAUSE: 'paused' } }, paused: { on: { START: 'running' } } },
}) : createMachine({
  initial: 'idle',
  states: { idle: { on: { START: 'running' } }, running: { on: { STOP: 'idle', PAUSE: 'paused' } }, paused: { on: { START: 'running' } } },
});
const state = () => m.state || m.current || (m.getState && m.getState());
assert.equal(state(), 'idle');
m.send('START');
assert.equal(state(), 'running');
m.send('START'); // invalid from running
assert.equal(state(), 'running', 'invalid event must not change state');
m.send('PAUSE'); m.send('START'); m.send('STOP');
assert.equal(state(), 'idle', 'full cycle');
process.exit(0);`,
};
