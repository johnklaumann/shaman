#!/usr/bin/env node
// Gate benchmark: run the REAL src/hooks/gate.js against a labeled prompt corpus
// and measure how its verdicts line up with human judgment of prompt quality.
//
// This is deterministic — gate.js is regex + structure checks, no API calls — so
// the numbers are exact and reproducible: same corpus in, same numbers out.
//
// Outcome of each prompt is read from the hook's real contract:
//   exit 2                       -> block  (coach refused it before any tokens)
//   exit 0 + additionalContext   -> enrich (passed, model told to state assumptions)
//   exit 0 + no stdout           -> pass   (strong prompt, zero overhead)
//
// Each prompt gets a unique session_id so the 3-min block cooldown never hides a
// block. Config is isolated in a temp dir so your real ~/.claude state is untouched.
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(here, '..', 'src', 'hooks', 'gate.js');
const CORPUS = path.join(here, 'corpus', 'prompts.jsonl');

const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-bench-'));
fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'),
  JSON.stringify({ mode: 'full', gate: 'coach' }));

function runGate(prompt, sessionId) {
  const stdin = JSON.stringify({ prompt, session_id: sessionId });
  const t0 = process.hrtime.bigint();
  const r = spawnSync('node', [GATE], {
    input: stdin,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    encoding: 'utf8',
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let outcome = 'pass';
  if (r.status === 2) outcome = 'block';
  else if ((r.stdout || '').includes('additionalContext')) outcome = 'enrich';
  return { outcome, ms };
}

const rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const cats = {};        // cat -> { block, enrich, pass, total }
const latencies = [];
let i = 0;
for (const row of rows) {
  const { outcome, ms } = runGate(row.text, `bench-sess-${i++}`);
  latencies.push(ms);
  const c = (cats[row.cat] ||= { block: 0, enrich: 0, pass: 0, total: 0 });
  c[outcome]++; c.total++;
  row.got = outcome;
}

// Expect-driven scoring against the human labels in the corpus:
//   expect block  -> must be caught (block, or enrich once the cooldown holds)
//   expect enrich -> must be enriched, never blocked, never passed silently
//   expect pass   -> must never be blocked; strong-task cats must pass SILENTLY
const caught = (o) => o === 'block' || o === 'enrich';
const vague = rows.filter((r) => r.expect === 'block');
const medium = rows.filter((r) => r.expect === 'enrich');
const legit = rows.filter((r) => r.expect === 'pass');
const strongCats = ['strong', 'complex-strong'];

const vagueRecall = vague.filter((r) => caught(r.got)).length / vague.length;
const vagueBlock = vague.filter((r) => r.got === 'block').length / vague.length;
const mediumCaught = medium.filter((r) => r.got === 'enrich').length / medium.length;
const falseBlocks = rows.filter((r) => r.expect !== 'block' && r.got === 'block');
const strongRows = rows.filter((r) => strongCats.includes(r.cat));
const strongSilent = strongRows.filter((r) => r.got === 'pass').length / strongRows.length;

latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];
const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;

const pf = (x) => (x * 100).toFixed(1) + '%';
console.log(`\nSHAMAN GATE BENCHMARK  —  ${rows.length} prompts (EN+PT), gate=coach\n`);
console.log('by category (block / enrich / pass):');
for (const [cat, c] of Object.entries(cats)) {
  console.log(`  ${cat.padEnd(9)} n=${String(c.total).padStart(2)}   ` +
    `block ${String(c.block).padStart(2)}  enrich ${String(c.enrich).padStart(2)}  pass ${String(c.pass).padStart(2)}`);
}
console.log('\nheadline metrics:');
console.log(`  vague caught (block|enrich) ....... ${pf(vagueRecall)}  (${vague.length} expect-block prompts)`);
console.log(`  vague hard-blocked ................ ${pf(vagueBlock)}`);
console.log(`  underspecified enriched ........... ${pf(mediumCaught)}  (${medium.length} expect-enrich prompts, incl. verbose-vague)`);
console.log(`  strong passed silently ............ ${pf(strongSilent)}  (${strongRows.length} incl. complex multi-requirement)`);
console.log(`  FALSE BLOCKS on legit prompts ..... ${falseBlocks.length} / ${legit.length + medium.length}  (${pf(falseBlocks.length / (legit.length + medium.length))})`);
if (falseBlocks.length) for (const f of falseBlocks) console.log(`      ! blocked: "${f.text.slice(0, 60)}"`);
console.log('\nlatency per prompt (end-to-end, incl. node cold start):');
console.log(`  mean ${mean.toFixed(1)}ms   p50 ${pct(0.5).toFixed(1)}ms   p95 ${pct(0.95).toFixed(1)}ms`);
console.log('  (heuristic itself is regex-only, no I/O, no API — sub-millisecond; the rest is node boot)\n');

fs.rmSync(cfg, { recursive: true, force: true });

// Machine-readable line for the footprint/report aggregator.
const summary = {
  prompts: rows.length, vagueRecall, vagueBlock, mediumCaught, strongSilent,
  falseBlocks: falseBlocks.length, legit: legit.length,
  latencyMeanMs: mean, latencyP95Ms: pct(0.95), cats,
};
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'gate.json'), JSON.stringify(summary, null, 2));
console.log('wrote bench/results/gate.json');

// --ci: regression gate. The two promises that define the product — every vague
// prompt caught, zero false blocks on legit prompts — fail the build if broken.
if (process.argv.includes('--ci')) {
  const fail = [];
  if (vagueRecall < 1) fail.push(`vague recall ${pf(vagueRecall)} < 100%`);
  if (falseBlocks.length > 0) fail.push(`${falseBlocks.length} false blocks`);
  if (strongSilent < 1) fail.push(`strong silent ${pf(strongSilent)} < 100%`);
  if (fail.length) {
    console.error(`CI GATE FAILED: ${fail.join('; ')}`);
    process.exit(1);
  }
  console.log('CI gate passed: 100% vague caught, 100% strong silent, 0 false blocks');
}
