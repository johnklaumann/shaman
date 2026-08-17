import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// state.js resolves paths from CLAUDE_CONFIG_DIR at call time, so point it at a
// temp dir before loading and restore after.
function withTempConfig(fn) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-state-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete require.cache[require.resolve('../src/lib/state.js')];
  const state = require('../src/lib/state.js');
  try { fn(state, cfg); } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(cfg, { recursive: true, force: true });
  }
}

test('loadState returns defaults when no file exists, not corrupt', () => {
  withTempConfig(({ loadState }) => {
    const { state, corrupt } = loadState();
    assert.equal(state.mode, 'full');
    assert.equal(state.gate, 'enrich');
    assert.equal(corrupt, false);
  });
});

test('corrupt state file is flagged so hooks never overwrite it with defaults', () => {
  withTempConfig(({ loadState, statePath, shamanDir }) => {
    fs.mkdirSync(shamanDir(), { recursive: true });
    fs.writeFileSync(statePath(), '{broken json');
    const { corrupt } = loadState();
    assert.equal(corrupt, true);
  });
});

test('writeState then loadState round-trips', () => {
  withTempConfig(({ loadState, writeState }) => {
    writeState({ mode: 'ultra', gate: 'coach' });
    assert.equal(loadState().state.mode, 'ultra');
  });
});

test('effectiveMode: ab alternates by day parity, other modes pass through', () => {
  withTempConfig(({ effectiveMode }) => {
    assert.equal(effectiveMode('ab', new Date(2026, 7, 17)), 'full');  // 17th, odd
    assert.equal(effectiveMode('ab', new Date(2026, 7, 18)), 'off');   // 18th, even
    assert.equal(effectiveMode('full', new Date(2026, 7, 18)), 'full');
    assert.equal(effectiveMode('off', new Date(2026, 7, 17)), 'off');
    assert.equal(effectiveMode('ultra', new Date(2026, 7, 18)), 'ultra');
  });
});

test('pruneSessions drops entries older than the TTL and keeps fresh ones', () => {
  withTempConfig(({ pruneSessions }) => {
    const out = pruneSessions({
      old: { mode: 'full', ts: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      fresh: { mode: 'full', ts: Date.now() },
    });
    assert.equal(out.old, undefined);
    assert.ok(out.fresh);
  });
});
