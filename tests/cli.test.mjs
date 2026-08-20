import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'src', 'cli', 'index.js');

const run = (args, opts = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });

function benchConfig(benchRows, gateRows = []) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-cli-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'bench.jsonl'), benchRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (gateRows.length) fs.writeFileSync(path.join(cfg, 'shaman', 'gate.jsonl'), gateRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return cfg;
}

test('score: weak prompt exits 2 with the card', () => {
  const r = run(['score', 'fix it']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /weak — would pause for confirmation/);
});

test('score: strong prompt exits 0', () => {
  const r = run(['score', 'Fix expiry in auth/middleware.ts — must reject with 401, keep refresh flow.']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /strong — passes silently/);
});

test('score: missing prompt exits 1 with usage', () => {
  const r = run(['score']);
  assert.equal(r.status, 1);
});

test('init writes all adapter files and refuses to overwrite without --force', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-cli-'));
  const first = run(['init'], { cwd: dir });
  assert.equal(first.status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'shaman.mdc')));
  const second = run(['init'], { cwd: dir });
  assert.match(second.stdout, /skip\s+AGENTS\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unknown command exits 1 and shows help', () => {
  const r = run(['dance']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
});

test('bench: aggregates convergence on-vs-off and gate telemetry', () => {
  const cfg = benchConfig([
    { session: 'on1', mode: 'full', requests: 50, userTurns: 5, output: 10000, input: 2000, sawEdit: true, callsBeforeFirstEdit: 8, exploreCalls: 6, readTokens: 5000 },
    { session: 'off1', mode: 'off', requests: 40, userTurns: 4, output: 12000, input: 3000, sawEdit: true, callsBeforeFirstEdit: 12, exploreCalls: 10, readTokens: 9000 },
  ], [
    { ts: '2026-08-20T10:00:00Z', session: 's1', gate: 'confirm', score: 12, band: 'weak', action: 'pause' },
    { ts: '2026-08-20T10:01:00Z', session: 's1', gate: 'confirm', score: 12, band: 'weak', action: 'enrich' },
    { ts: '2026-08-20T10:02:00Z', session: 's2', gate: 'confirm', score: 80, band: 'strong', action: 'pass' },
  ]);
  const r = run(['bench'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /convergence \(edit sessions\)/);
  assert.match(r.stdout, /on {2}.* 8 /);         // on median calls before edit
  assert.match(r.stdout, /off {2}.* 12 /);       // off median
  assert.match(r.stdout, /gate \(router telemetry\) — 3 scored prompts/);
  assert.match(r.stdout, /proceed-rate: 100% \(1\/1/); // the one pause was resent
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('bench: older records without convergence fields are skipped, not crashed on', () => {
  const cfg = benchConfig([
    { session: 'legacy', mode: 'full', requests: 10, userTurns: 2, output: 500, input: 100 }, // pre-instrumentation
  ]);
  const r = run(['bench'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /convergence \(edit sessions\)/);
  fs.rmSync(cfg, { recursive: true, force: true });
});
