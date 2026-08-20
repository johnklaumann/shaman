import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(root, 'src', 'hooks', 'verify.js');

// Build a temp project + config + transcript, run verify.js as the Stop hook.
function setup({ files = {}, finalText = '', config = null, state = { mode: 'full', verify: 'on' }, sessionId = 'v1' } = {}) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-vcfg-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-vproj-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'), JSON.stringify(state));
  if (config) fs.writeFileSync(path.join(cwd, '.shaman.json'), JSON.stringify({ verify: config }));

  const edited = [];
  const lines = [];
  let i = 0;
  for (const [name, content] of Object.entries(files)) {
    const fp = path.join(cwd, name);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
    edited.push(fp);
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't' + i++, name: 'Edit', input: { file_path: fp } }] } }));
  }
  lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalText }] } }));
  const tp = path.join(cwd, 'transcript.jsonl');
  fs.writeFileSync(tp, lines.join('\n') + '\n');

  const run = () => {
    const r = spawnSync('node', [VERIFY], {
      input: JSON.stringify({ session_id: sessionId, transcript_path: tp, cwd, stop_hook_active: false }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8',
    });
    const lp = path.join(cfg, 'shaman', 'verify.jsonl');
    const log = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { r, log };
  };
  const cleanup = () => { fs.rmSync(cfg, { recursive: true, force: true }); fs.rmSync(cwd, { recursive: true, force: true }); };
  return { run, cleanup };
}

test('claim + hardcoded secret in edited non-test file → blocks with evidence', () => {
  const { run, cleanup } = setup({ files: { 'api.js': 'const apiKey = "supersecret123";\n' }, finalText: 'Done — everything works.' });
  const { r, log } = run();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /SHAMAN VERIFY/);
  assert.match(r.stderr, /security/i);
  assert.equal(log.at(-1).blocked, true);
  cleanup();
});

test('WIP wording never blocks, even with a finding present', () => {
  const { run, cleanup } = setup({ files: { 'api.js': 'const apiKey = "supersecret123";\n' }, finalText: 'Fixed the parser but tests still failing.' });
  const { r, log } = run();
  assert.equal(r.status, 0);
  assert.equal(log.at(-1).claim, false);
  cleanup();
});

test('no edits → silent, no log, no block', () => {
  const { run, cleanup } = setup({ files: {}, finalText: 'Done.' });
  const { r, log } = run();
  assert.equal(r.status, 0);
  assert.equal(log.length, 0);
  cleanup();
});

test('finding in a TEST file does not block', () => {
  const { run, cleanup } = setup({ files: { 'api.test.js': 'const apiKey = "supersecret123";\n' }, finalText: 'Done.' });
  const { r } = run();
  assert.equal(r.status, 0);
  cleanup();
});

test('configured check that fails → blocks with "check failed"', () => {
  const { run, cleanup } = setup({
    files: { 'a.js': 'const x = 1;\n' }, finalText: 'All done and passing.',
    config: { checks: ['node -e "process.exit(1)"'] },
  });
  const { r } = run();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /check failed/);
  cleanup();
});

test('configured check that passes + clean code → no block', () => {
  const { run, cleanup } = setup({
    files: { 'a.js': 'const x = 1;\n' }, finalText: 'All done and passing.',
    config: { checks: ['node -e "process.exit(0)"'] },
  });
  const { r } = run();
  assert.equal(r.status, 0);
  cleanup();
});

test('dedupe: the same issue is confronted at most once per session', () => {
  const { run, cleanup } = setup({ files: { 'api.js': 'const apiKey = "supersecret123";\n' }, finalText: 'Done.' });
  assert.equal(run().r.status, 2, 'first run blocks');
  assert.equal(run().r.status, 0, 'second run does not re-block the same issue');
  cleanup();
});

test('verify=off disables entirely', () => {
  const { run, cleanup } = setup({ files: { 'api.js': 'const apiKey = "supersecret123";\n' }, finalText: 'Done.', state: { mode: 'full', verify: 'off' } });
  assert.equal(run().r.status, 0);
  cleanup();
});

test('fail-open on malformed stdin', () => {
  const r = spawnSync('node', [VERIFY], { input: 'not json{{', encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0);
});
