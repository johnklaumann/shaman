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

test('score: weak prompt exits 2 with the card', () => {
  const r = run(['score', 'fix it']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /weak — would be blocked/);
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
