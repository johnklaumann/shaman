import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVATE = path.join(root, 'src', 'hooks', 'activate.js');

function run(state, input = {}) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-act-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'), JSON.stringify(state));
  const r = spawnSync('node', [ACTIVATE], {
    input: JSON.stringify({ session_id: 'act-test', ...input }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    encoding: 'utf8',
  });
  const after = JSON.parse(fs.readFileSync(path.join(cfg, 'shaman', 'state.json'), 'utf8'));
  fs.rmSync(cfg, { recursive: true, force: true });
  return { ...r, after };
}

test('full mode injects the ruleset with level and gate in the header', () => {
  const r = run({ mode: 'full', gate: 'coach' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^# SHAMAN ACTIVE — level: full, gate: coach$/m);
  assert.match(r.stdout, /decision ladder/i);
});

test('off mode injects nothing', () => {
  const r = run({ mode: 'off', gate: 'enrich' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('lite keeps articles: the drop-articles rule is removed', () => {
  const r = run({ mode: 'lite', gate: 'enrich' });
  assert.doesNotMatch(r.stdout, /^- Drop articles/m);
});

test('ultra appends the one-word rule', () => {
  const r = run({ mode: 'ultra', gate: 'enrich' });
  assert.match(r.stdout, /One word when one word enough/);
});

test('session start records the session mode for bench attribution', () => {
  const r = run({ mode: 'full', gate: 'enrich' });
  assert.equal(r.after.sessions['act-test'].mode, 'full');
});

test('subagent start injects rules but skips session bookkeeping', () => {
  const r = run({ mode: 'full', gate: 'enrich' }, { hook_event_name: 'SubagentStart', session_id: 'sub-1' });
  assert.match(r.stdout, /SHAMAN ACTIVE/);
  assert.equal(r.after.sessions?.['sub-1'], undefined);
});
