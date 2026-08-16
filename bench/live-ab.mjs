#!/usr/bin/env node
// Live A/B benchmark: the real end-to-end measurement. For each task in
// corpus/tasks.jsonl, call `claude -p` TWICE with the same model and prompt:
//   OFF = plugin uninstalled  -> plain call, no ruleset
//   ON  = plugin installed    -> --append-system-prompt <rules/core.md> (what
//                                activate.js injects at SessionStart)
// and compare usage.output_tokens. For code tasks it also counts lines inside the
// first fenced code block, so the "build less" pillar shows up as code volume.
//
// This is the only bench that spends tokens and needs the network. It writes real
// per-task numbers to bench/results/live.json.
//
// NESTED-SESSION GUARD: Claude Code refuses to launch inside another Claude Code
// session ("will crash all active sessions") unless CLAUDECODE is unset. This
// harness deletes CLAUDECODE from the child env and passes --no-session-persistence,
// so the nested -p calls run without touching the parent session. A plain terminal is
// still the cleanest place to run this.
//
//   node bench/live-ab.mjs [model]      # default model: claude-haiku-4-5
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TASKS = path.join(here, 'corpus', 'tasks.jsonl');
const RULES = fs.readFileSync(path.join(here, '..', 'rules', 'core.md'), 'utf8');
const MODEL = process.argv[2] || 'claude-haiku-4-5';

function callClaude(prompt, withRules) {
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--max-turns', '1',
    '--no-session-persistence', '--max-budget-usd', '0.10',
    '--disallowedTools', 'Bash Edit Write Read Glob Grep'];
  if (withRules) args.push('--append-system-prompt', RULES);
  // Deleting CLAUDECODE (not just blanking it) lets the child launch even if this
  // harness is run from inside a Claude Code session; --no-session-persistence keeps
  // the nested run from touching the parent session's transcript. CLAUDE_CONFIG_DIR
  // is left as-is because the child needs the real config for auth.
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const r = spawnSync('claude', args, {
    input: prompt, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { error: r.stderr || 'no json', tokens: 0, text: '' }; }
  return { tokens: out.usage?.output_tokens || 0, text: out.result || '', cost: out.total_cost_usd || 0 };
}

// Non-deterministic model output is noisy at n=1 (one run gave -64% on a task the
// next gave +27%), so every task is run TRIALS times per side and averaged. TRIALS
// defaults to 3; raise it (3rd arg) for a tighter estimate at proportional cost.
const TRIALS = Number.parseInt(process.argv[3], 10) || 3;

// Lines across ALL fenced code blocks — the code the model actually emitted. Summing
// every block (not just the first) avoids undercounting answers that split the code,
// and answers with no fence at all score 0 honestly.
function codeLines(text) {
  return [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)]
    .reduce((n, m) => n + m[1].split('\n').filter((l) => l.trim()).length, 0);
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runTrials(prompt, withRules, isCode) {
  const toks = [], locs = [];
  let cost = 0, sample = '';
  for (let k = 0; k < TRIALS; k++) {
    const r = callClaude(prompt, withRules);
    if (r.error) continue;
    toks.push(r.tokens);
    if (isCode) locs.push(codeLines(r.text));
    cost += r.cost || 0;
    if (!sample) sample = r.text;
  }
  return { tokMean: mean(toks), locMean: mean(locs), toks, locs, cost, sample };
}

const tasks = fs.readFileSync(TASKS, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(`\nSHAMAN LIVE A/B  —  ${tasks.length} tasks, model ${MODEL}, ${TRIALS} trials/side (mean)\n`);
console.log('  id                  kind     off tok   on tok   saved   off LOC  on LOC   off tok range');

const rows = [];
let sumOff = 0, sumOn = 0, sumOffLOC = 0, sumOnLOC = 0, cost = 0;
for (const t of tasks) {
  const isCode = t.kind === 'code';
  const off = runTrials(t.prompt, false, isCode);
  const on = runTrials(t.prompt, true, isCode);
  cost += off.cost + on.cost;
  if (!off.toks.length || !on.toks.length) { console.log(`  ${t.id.padEnd(19)} ERROR (all trials failed)`); continue; }
  sumOff += off.tokMean; sumOn += on.tokMean; sumOffLOC += off.locMean; sumOnLOC += on.locMean;
  const saved = 1 - on.tokMean / off.tokMean;
  const range = `${Math.min(...off.toks)}-${Math.max(...off.toks)}`;
  rows.push({ id: t.id, kind: t.kind, offTokMean: off.tokMean, onTokMean: on.tokMean, saved,
    offLocMean: off.locMean, onLocMean: on.locMean, offToks: off.toks, onToks: on.toks,
    offLocs: off.locs, onLocs: on.locs, sampleOff: off.sample, sampleOn: on.sample });
  console.log(`  ${t.id.padEnd(19)} ${t.kind.padEnd(7)} ${off.tokMean.toFixed(0).padStart(6)}   ${on.tokMean.toFixed(0).padStart(6)}   ${(saved * 100).toFixed(0).padStart(3)}%   ${off.locMean.toFixed(1).padStart(6)}  ${on.locMean.toFixed(1).padStart(6)}   ${range}`);
}

const overall = sumOff ? 1 - sumOn / sumOff : 0;
const locSaved = sumOffLOC ? 1 - sumOnLOC / sumOffLOC : 0;
console.log('  ' + '-'.repeat(80));
console.log(`  ${'TOTAL (mean)'.padEnd(19)} ${''.padEnd(7)} ${sumOff.toFixed(0).padStart(6)}   ${sumOn.toFixed(0).padStart(6)}   ${(overall * 100).toFixed(0).padStart(3)}%   ${sumOffLOC.toFixed(1).padStart(6)}  ${sumOnLOC.toFixed(1).padStart(6)}`);
console.log(`\n  output tokens saved, pooled mean ...... ${(overall * 100).toFixed(1)}%  (${sumOff.toFixed(0)} -> ${sumOn.toFixed(0)})`);
console.log(`  code lines saved, pooled mean ......... ${(locSaved * 100).toFixed(1)}%  (${sumOffLOC.toFixed(1)} -> ${sumOnLOC.toFixed(1)} LOC over ${rows.filter((r) => r.kind === 'code').length} code tasks)`);
console.log(`  approx spend on this run .............. $${cost.toFixed(3)}`);
console.log(`  NOTE: ${TRIALS} trials, ${tasks.length} tasks, ${MODEL}. Model output is high-variance — see per-task token range. Directional, not a guarantee; /usage is the source of truth.\n`);

fs.writeFileSync(path.join(here, 'results', 'live.json'),
  JSON.stringify({ model: MODEL, trials: TRIALS, tasks: rows, pooledSaved: overall, locSaved, sumOff, sumOn, sumOffLOC, sumOnLOC, costUsd: cost }, null, 2));
console.log('wrote bench/results/live.json\n');
