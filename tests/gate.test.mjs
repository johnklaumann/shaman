import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(root, 'src', 'hooks', 'gate.js');

// Each test gets an isolated CLAUDE_CONFIG_DIR — the real ~/.claude is never touched.
function makeConfig(state = { mode: 'full', gate: 'coach' }) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-test-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'), JSON.stringify(state));
  return cfg;
}

function runGate(cfg, prompt, sessionId = 's1') {
  return spawnSync('node', [GATE], {
    input: JSON.stringify({ prompt, session_id: sessionId }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    encoding: 'utf8',
  });
}

test('coach blocks a vague prompt with the scorecard on stderr', () => {
  const cfg = makeConfig();
  const r = runGate(cfg, 'fix it');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SHAMAN GATE/);
  assert.match(r.stderr, /\/100/);
  assert.match(r.stderr, /target/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('block cooldown: second vague prompt in the same session falls back to enrich', () => {
  const cfg = makeConfig();
  assert.equal(runGate(cfg, 'fix it', 'same').status, 2);
  const second = runGate(cfg, 'make it better', 'same');
  assert.equal(second.status, 0);
  const out = JSON.parse(second.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /scored \d+\/100/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('strong prompt passes silently — zero output', () => {
  const cfg = makeConfig();
  const r = runGate(cfg, 'Fix the token expiry check in auth/middleware.ts — expired tokens still pass, must reject with 401.');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('enrich mode never blocks, even weak prompts', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'enrich' });
  const r = runGate(cfg, 'fix it');
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /assumptions/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('confirm pauses a weak prompt with the scorecard and a preview of the added context', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'confirm' });
  const r = runGate(cfg, 'fix it');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SHAMAN GATE/);
  assert.match(r.stderr, /Context I'll add/);
  assert.match(r.stderr, /PROCEED/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('confirm: resending within cooldown proceeds with the context injected', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'confirm' });
  assert.equal(runGate(cfg, 'fix it', 'c1').status, 2);
  const second = runGate(cfg, 'fix it', 'c1');
  assert.equal(second.status, 0);
  assert.match(JSON.parse(second.stdout).hookSpecificOutput.additionalContext, /assumptions/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('confirm is the default: a state file with no gate pauses weak prompts', () => {
  const cfg = makeConfig({ mode: 'full' }); // no gate key -> DEFAULTS.gate
  const r = runGate(cfg, 'fix it');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Context I'll add/);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('/shaman-gate confirm persists the mode', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'off' });
  assert.equal(runGate(cfg, '/shaman-gate confirm').status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(cfg, 'shaman', 'state.json'), 'utf8'));
  assert.equal(state.gate, 'confirm');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('gate telemetry: logs one line per scored prompt with score/band/action to gate.jsonl', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'confirm' });
  runGate(cfg, 'fix it', 's-tel');                                    // weak + confirm -> pause
  runGate(cfg, 'Fix the token expiry check in auth/middleware.ts — expired tokens still pass, must reject with 401.', 's-tel2'); // strong -> pass
  const lines = fs.readFileSync(path.join(cfg, 'shaman', 'gate.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pause = lines.find((l) => l.action === 'pause');
  assert.ok(pause, 'a pause was logged');
  assert.equal(pause.band, 'weak');
  assert.equal(typeof pause.score, 'number');
  assert.ok(lines.some((l) => l.action === 'pass'), 'the strong prompt logged a pass');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('gate telemetry: disabled gate writes nothing', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'off' });
  runGate(cfg, 'fix it', 's-off');
  assert.equal(fs.existsSync(path.join(cfg, 'shaman', 'gate.jsonl')), false);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('gate off: everything passes untouched', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'off' });
  const r = runGate(cfg, 'fix it');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('slash commands are never gated; mode command persists state', () => {
  const cfg = makeConfig();
  const r = runGate(cfg, '/shaman ultra');
  assert.equal(r.status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(cfg, 'shaman', 'state.json'), 'utf8'));
  assert.equal(state.mode, 'ultra');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('mid-session mode switch marks the session mixed for bench honesty', () => {
  const cfg = makeConfig({ mode: 'full', gate: 'coach', sessions: { s9: { mode: 'full', gate: 'coach', ts: Date.now() } } });
  runGate(cfg, '/shaman off', 's9');
  const state = JSON.parse(fs.readFileSync(path.join(cfg, 'shaman', 'state.json'), 'utf8'));
  assert.equal(state.sessions.s9.mode, 'mixed');
  assert.equal(state.mode, 'off');
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('ab mode command persists; on an off-day the gate stays silent', () => {
  const cfg = makeConfig();
  assert.equal(runGate(cfg, '/shaman ab').status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(cfg, 'shaman', 'state.json'), 'utf8'));
  assert.equal(state.mode, 'ab');
  const r = runGate(cfg, 'fix it', 's-ab');
  if (new Date().getDate() % 2 === 0) {
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'off-day: no enrichment, vanilla arm stays clean');
  } else {
    assert.equal(r.status, 2, 'on-day: coach still blocks');
  }
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('questions are never blocked even in coach mode', () => {
  const cfg = makeConfig();
  const r = runGate(cfg, 'why does test_login fail?');
  assert.equal(r.status, 0);
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('gate fails open on malformed stdin', () => {
  const r = spawnSync('node', [GATE], { input: 'not json{{', env: { ...process.env, CLAUDE_CONFIG_DIR: makeConfig() }, encoding: 'utf8' });
  assert.equal(r.status, 0);
});
