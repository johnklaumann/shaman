#!/usr/bin/env node
// Live A/B v2 — tiered, correctness-gated, the professional run.
//
// For each task in corpus/tasks2.jsonl (tiers: small / medium / large), call
// `claude -p` TRIALS times per arm with the same prompt:
//   OFF = plain call, no ruleset
//   ON  = rules/core.md appended as system prompt (what activate.js injects)
// and measure, per trial:
//   output tokens (provider-reported), wall time,
//   LOC across all fenced code blocks, comment lines,
//   CORRECTNESS: the extracted code is written to impl.cjs and executed against
//   the task's adversarial assert script (bench/checks.mjs) in a sandboxed child
//   process with a hard timeout. Fewer lines that fail the gate are a loss, not
//   a saving — this is what makes the LOC numbers mean something.
//
// Both arms get the identical prompt, which states an explicit module.exports
// contract, so extraction and checking are fair.
//
//   node bench/live-ab2.mjs [model] [trials]     # defaults: claude-haiku-4-5, 3
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, runCheck } from './checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RULES = fs.readFileSync(path.join(here, '..', 'rules', 'core.md'), 'utf8');
const MODEL = process.argv[2] || 'claude-haiku-4-5';
const TRIALS = Number.parseInt(process.argv[3], 10) || 3;

// max-turns 4 + a full comma-separated disallow list: haiku occasionally burns a
// turn on a tool call (a "TODO store" prompt triggers TodoWrite) — with
// max-turns 1 that returned 1200 paid tokens and an EMPTY result. Belt and
// braces: retry once on empty text, and drop the trial if still empty so
// non-answers never poison the token means.
function callClaude(prompt, withRules) {
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--max-turns', '4',
    '--no-session-persistence', '--max-budget-usd', '0.15',
    '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,TodoWrite,Task,WebFetch,WebSearch,NotebookEdit'];
  if (withRules) args.push('--append-system-prompt', RULES);
  const env = { ...process.env };
  delete env.CLAUDECODE; // proven pattern: lets the nested -p run without touching this session
  const t0 = Date.now();
  const r = spawnSync('claude', args, { input: prompt, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const ms = Date.now() - t0;
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { error: (r.stderr || 'no json').slice(0, 200), tokens: 0, text: '', ms }; }
  return { tokens: out.usage?.output_tokens || 0, text: out.result || '', cost: out.total_cost_usd || 0, ms };
}

// JS-tagged (or untagged) fences first; if the model used another tag, fall
// back to every fence rather than scoring a real answer as "no code".
function extractCode(text) {
  const js = [...text.matchAll(/```(?:javascript|js|node|cjs|mjs)?\s*\n([\s\S]*?)```/g)];
  const blocks = js.length ? js : [...text.matchAll(/```[\w-]*\s*\n([\s\S]*?)```/g)];
  return blocks.map((m) => m[1]).join('\n');
}
const countLoc = (code) => code.split('\n').filter((l) => l.trim()).length;
const countComments = (code) => code.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l.trim())).length;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runArm(task, withRules) {
  const trials = [];
  let cost = 0, sample = '';
  for (let k = 0; k < TRIALS; k++) {
    let r = callClaude(task.prompt, withRules);
    cost += r.cost || 0;
    if (!r.error && !r.text.trim()) { r = callClaude(task.prompt, withRules); cost += r.cost || 0; }
    if (r.error || !r.text.trim()) { console.log(`    trial dropped (${task.id} ${withRules ? 'on' : 'off'}): ${r.error || 'empty result twice'}`); continue; }
    const code = extractCode(r.text);
    const check = runCheck(task.id, code);
    if (!sample) sample = r.text;
    trials.push({ tokens: r.tokens, ms: r.ms, loc: countLoc(code), comments: countComments(code), pass: check.pass, reason: check.reason });
    console.log(`    ${task.id} ${withRules ? 'on ' : 'off'} trial ${k + 1}: ${r.tokens} tok, ${countLoc(code)} loc, ${check.pass ? 'PASS' : 'FAIL(' + check.reason + ')'}`);
  }
  return {
    trials, cost, sample,
    tok: mean(trials.map((t) => t.tokens)),
    ms: mean(trials.map((t) => t.ms)),
    loc: mean(trials.map((t) => t.loc)),
    comments: mean(trials.map((t) => t.comments)),
    passRate: mean(trials.map((t) => (t.pass ? 1 : 0))),
  };
}

const tasks = fs.readFileSync(path.join(here, 'corpus', 'tasks2.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
for (const t of tasks) if (!CHECKS[t.id]) { console.error(`no check for task ${t.id}`); process.exit(1); }

console.log(`SHAMAN LIVE A/B v2 — ${tasks.length} tasks (4 small / 6 medium / 4 large), model ${MODEL}, ${TRIALS} trials/arm, correctness-gated\n`);

const rows = [];
let totalCost = 0;
for (const task of tasks) {
  console.log(`  == ${task.id} (${task.tier})`);
  const off = runArm(task, false);
  const on = runArm(task, true);
  totalCost += off.cost + on.cost;
  if (!off.trials.length || !on.trials.length) { console.log(`  ${task.id}: all trials failed, skipping row`); continue; }
  rows.push({ id: task.id, tier: task.tier, off, on });
}

const pf = (x) => `${(x * 100).toFixed(0)}%`;
console.log(`\n  ${'task'.padEnd(15)}${'tier'.padEnd(8)}${'off tok'.padStart(8)}${'on tok'.padStart(8)}${'saved'.padStart(7)}${'off LOC'.padStart(9)}${'on LOC'.padStart(8)}${'off pass'.padStart(10)}${'on pass'.padStart(9)}`);
for (const r of rows) {
  console.log(`  ${r.id.padEnd(15)}${r.tier.padEnd(8)}${r.off.tok.toFixed(0).padStart(8)}${r.on.tok.toFixed(0).padStart(8)}${pf(1 - r.on.tok / r.off.tok).padStart(7)}${r.off.loc.toFixed(1).padStart(9)}${r.on.loc.toFixed(1).padStart(8)}${pf(r.off.passRate).padStart(10)}${pf(r.on.passRate).padStart(9)}`);
}

function rollup(rs) {
  const s = (f, arm) => rs.reduce((a, r) => a + r[arm][f], 0);
  return {
    n: rs.length,
    offTok: s('tok', 'off'), onTok: s('tok', 'on'),
    offLoc: s('loc', 'off'), onLoc: s('loc', 'on'),
    offMs: mean(rs.map((r) => r.off.ms)), onMs: mean(rs.map((r) => r.on.ms)),
    offComments: s('comments', 'off'), onComments: s('comments', 'on'),
    offPass: mean(rs.map((r) => r.off.passRate)), onPass: mean(rs.map((r) => r.on.passRate)),
  };
}

console.log(`\n  by tier:`);
const tiers = {};
for (const tier of ['small', 'medium', 'large']) {
  const t = rollup(rows.filter((r) => r.tier === tier));
  tiers[tier] = t;
  console.log(`  ${tier.padEnd(7)} tok ${t.offTok.toFixed(0)} -> ${t.onTok.toFixed(0)} (${pf(1 - t.onTok / t.offTok)} saved)   LOC ${t.offLoc.toFixed(0)} -> ${t.onLoc.toFixed(0)} (${pf(1 - t.onLoc / t.offLoc)})   pass off ${pf(t.offPass)} / on ${pf(t.onPass)}   time ${(t.offMs / 1000).toFixed(1)}s -> ${(t.onMs / 1000).toFixed(1)}s`);
}
const all = rollup(rows);
console.log(`\n  OVERALL  tokens ${pf(1 - all.onTok / all.offTok)} saved (${all.offTok.toFixed(0)} -> ${all.onTok.toFixed(0)})`);
console.log(`           LOC    ${pf(1 - all.onLoc / all.offLoc)} saved (${all.offLoc.toFixed(0)} -> ${all.onLoc.toFixed(0)})`);
console.log(`           comment lines ${all.offComments.toFixed(0)} -> ${all.onComments.toFixed(0)}`);
console.log(`           correctness off ${pf(all.offPass)} / on ${pf(all.onPass)}  (${TRIALS} trials x ${rows.length} tasks per arm)`);
console.log(`           mean time/task ${(all.offMs / 1000).toFixed(1)}s -> ${(all.onMs / 1000).toFixed(1)}s`);
console.log(`           spend $${totalCost.toFixed(3)}  model ${MODEL}`);

fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'live2.json'),
  JSON.stringify({ model: MODEL, trials: TRIALS, rows, tiers, overall: all, costUsd: totalCost }, null, 2));
console.log(`\nwrote bench/results/live2.json`);
