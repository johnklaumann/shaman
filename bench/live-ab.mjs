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
// harness sets CLAUDECODE='' for its child calls. Run it from a PLAIN terminal, not
// from inside a Claude Code session, or the guard exists for a reason.
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
    '--max-budget-usd', '0.10', '--disallowedTools', 'Bash Edit Write Read Glob Grep'];
  if (withRules) args.push('--append-system-prompt', RULES);
  const r = spawnSync('claude', args, {
    input: prompt,
    // CLAUDECODE='' lets the child run even if this harness is (wrongly) launched
    // from within a Claude Code session; CLAUDE_CONFIG_DIR is left as-is.
    env: { ...process.env, CLAUDECODE: '' },
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { error: r.stderr || 'no json', tokens: 0, text: '' }; }
  return { tokens: out.usage?.output_tokens || 0, text: out.result || '', cost: out.total_cost_usd || 0 };
}

// Lines inside the first ```fenced``` block — the code the model actually emitted.
function codeLines(text) {
  const m = text.match(/```[\w-]*\n([\s\S]*?)```/);
  if (!m) return 0;
  return m[1].split('\n').filter((l) => l.trim()).length;
}

const tasks = fs.readFileSync(TASKS, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(`\nSHAMAN LIVE A/B  —  ${tasks.length} tasks, model ${MODEL}, 2 calls each (off vs on)\n`);
console.log('  id                  kind     off tok   on tok   saved   off LOC  on LOC');

const rows = [];
let sumOff = 0, sumOn = 0, cost = 0;
for (const t of tasks) {
  const off = callClaude(t.prompt, false);
  const on = callClaude(t.prompt, true);
  cost += (off.cost || 0) + (on.cost || 0);
  if (off.error || on.error) { console.log(`  ${t.id.padEnd(19)} ERROR ${off.error || on.error}`); continue; }
  sumOff += off.tokens; sumOn += on.tokens;
  const saved = off.tokens ? 1 - on.tokens / off.tokens : 0;
  const offLOC = t.kind === 'code' ? codeLines(off.text) : 0;
  const onLOC = t.kind === 'code' ? codeLines(on.text) : 0;
  rows.push({ id: t.id, kind: t.kind, off: off.tokens, on: on.tokens, saved, offLOC, onLOC });
  console.log(`  ${t.id.padEnd(19)} ${t.kind.padEnd(7)} ${String(off.tokens).padStart(6)}   ${String(on.tokens).padStart(6)}   ${(saved * 100).toFixed(0).padStart(3)}%   ${String(offLOC).padStart(6)}  ${String(onLOC).padStart(6)}`);
}

const overall = sumOff ? 1 - sumOn / sumOff : 0;
console.log('  ' + '-'.repeat(70));
console.log(`  ${'TOTAL'.padEnd(19)} ${''.padEnd(7)} ${String(sumOff).padStart(6)}   ${String(sumOn).padStart(6)}   ${(overall * 100).toFixed(0).padStart(3)}%`);
console.log(`\n  output tokens saved, pooled ...... ${(overall * 100).toFixed(1)}%  (${sumOff} -> ${sumOn})`);
console.log(`  approx spend on this run ......... $${cost.toFixed(3)}`);
console.log(`  NOTE: single run, ${tasks.length} tasks, ${MODEL}. Small n — treat as directional, not a guarantee.\n`);

fs.writeFileSync(path.join(here, 'results', 'live.json'),
  JSON.stringify({ model: MODEL, tasks: rows, pooledSaved: overall, sumOff, sumOn, costUsd: cost }, null, 2));
console.log('wrote bench/results/live.json\n');
