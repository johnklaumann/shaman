#!/usr/bin/env node
// Footprint benchmark: measure the exact size of the ruleset shaman injects at
// SessionStart, per mode, by running the REAL src/hooks/activate.js. Also isolates
// the gate's per-prompt latency from node's cold-start floor.
//
// Char and word counts are exact. Token counts use tiktoken's cl100k (OpenAI) as a
// proxy — Claude's tokenizer is not public; expect it within ~10-15%. Labeled as
// an estimate everywhere it surfaces.
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ACTIVATE = path.join(here, '..', 'src', 'hooks', 'activate.js');

function countTokens(text) {
  const r = spawnSync('python', ['-c',
    'import sys,tiktoken; print(len(tiktoken.get_encoding("cl100k_base").encode(sys.stdin.read())))'],
    { input: text, encoding: 'utf8' });
  return parseInt((r.stdout || '0').trim(), 10) || 0;
}

function runActivate(mode) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-fp-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'), JSON.stringify({ mode, gate: 'enrich' }));
  const r = spawnSync('node', [ACTIVATE], {
    input: JSON.stringify({ session_id: `fp-${mode}` }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8',
  });
  fs.rmSync(cfg, { recursive: true, force: true });
  return r.stdout || '';
}

// node cold-start floor: spawn an empty node process 20x, take the median.
function bootFloorMs() {
  const xs = [];
  for (let i = 0; i < 20; i++) {
    const t0 = process.hrtime.bigint();
    spawnSync('node', ['-e', '0']);
    xs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

const modes = ['full', 'lite', 'ultra', 'off'];
const rows = {};
console.log('\nSHAMAN RULESET FOOTPRINT  (injected once per session at SessionStart)\n');
console.log('  mode    chars   words   ~tokens (cl100k proxy)');
for (const m of modes) {
  const text = runActivate(m);
  const chars = text.length, words = text.split(/\s+/).filter(Boolean).length;
  const tokens = text.trim() ? countTokens(text) : 0;
  rows[m] = { chars, words, tokens };
  console.log(`  ${m.padEnd(6)}  ${String(chars).padStart(5)}   ${String(words).padStart(5)}   ${String(tokens).padStart(5)}`);
}
console.log('\n  off = plugin injects nothing (0 tokens). full = default.');

const boot = bootFloorMs();
console.log(`\nHOOK LATENCY DECOMPOSITION`);
console.log(`  node cold-start floor (median of 20) .... ${boot.toFixed(1)}ms`);
console.log(`  gate end-to-end (from gate-bench) ....... see bench/results/gate.json`);
try {
  const g = JSON.parse(fs.readFileSync(path.join(here, 'results', 'gate.json'), 'utf8'));
  console.log(`  gate mean end-to-end .................... ${g.latencyMeanMs.toFixed(1)}ms`);
  console.log(`  => gate heuristic + require (e2e - boot)  ~${Math.max(0, g.latencyMeanMs - boot).toFixed(1)}ms`);
} catch { console.log('  (run gate-bench.mjs first for the delta)'); }
console.log('');

fs.writeFileSync(path.join(here, 'results', 'footprint.json'),
  JSON.stringify({ rules: rows, nodeBootMedianMs: boot }, null, 2));
console.log('wrote bench/results/footprint.json\n');
