#!/usr/bin/env node
// Agentic benchmark — the whole-session answer. Real multi-turn Claude Code
// sessions WITH tools (read/edit/bash) over the pinned fixture app, one ticket
// per session, off vs on:
//   OFF = plain session
//   ON  = rules/core.md appended as system prompt (what the plugin injects)
// measuring what single-shot benches cannot: TOTAL session tokens (input +
// output + cache-write, cache-read reported separately), provider-reported
// cost, wall time, turns, diff size — and whether the work is actually DONE:
// the fixture test suite must stay green and the ticket's acceptance check
// (bench/agentic-checks.mjs, black-box over the HTTP API) must pass.
//
// Isolation per session: fresh copy of the fixture in a temp dir with its own
// git repo; `--setting-sources project,local` so no user-level plugins or
// hooks contaminate either arm (the temp cwd has no project settings);
// CLAUDECODE deleted so the nested run is allowed; budget-capped per session.
//
//   node bench/agentic.mjs [model] [trials]    # defaults: claude-haiku-4-5, 2
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTIC_CHECKS, fixtureTestsPass } from './agentic-checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'notes-api');
const RULES = fs.readFileSync(path.join(here, '..', 'rules', 'core.md'), 'utf8');
const MODEL = process.argv[2] || 'claude-haiku-4-5';
const TRIALS = Number.parseInt(process.argv[3], 10) || 2;
const BUDGET_PER_SESSION = '0.35';

const git = (dir, ...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-agentic-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'bench@shaman.local');
  git(dir, 'config', 'user.name', 'shaman-bench');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture baseline');
  return dir;
}

function addedLines(dir) {
  const r = git(dir, 'diff', '--numstat', 'HEAD');
  return (r.stdout || '').split('\n').filter(Boolean)
    .reduce((n, line) => n + (Number.parseInt(line.split('\t')[0], 10) || 0), 0);
}

function runSession(dir, prompt, withRules) {
  const args = ['-p', '--output-format', 'json', '--model', MODEL,
    '--max-turns', '30', '--max-budget-usd', BUDGET_PER_SESSION,
    '--no-session-persistence', '--setting-sources', 'project,local',
    '--dangerously-skip-permissions',
    '--disallowedTools', 'WebFetch,WebSearch,Task'];
  if (withRules) args.push('--append-system-prompt', RULES);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  const t0 = Date.now();
  const r = spawnSync('claude', args, {
    cwd: dir, input: prompt, env, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000,
  });
  const ms = Date.now() - t0;
  let out;
  try { out = JSON.parse(r.stdout); } catch {
    return { error: (r.stderr || 'no json').slice(0, 200), ms };
  }
  const u = out.usage || {};
  return {
    ms,
    turns: out.num_turns || 0,
    cost: out.total_cost_usd || 0,
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

async function runCell(task, withRules, trial) {
  const dir = makeWorkspace();
  try {
    const s = runSession(dir, task.prompt, withRules);
    if (s.error) return { error: s.error };
    const tests = fixtureTestsPass(dir);
    const accept = await AGENTIC_CHECKS[task.id](dir);
    const done = tests.pass && accept.pass;
    const cell = {
      trial, ...s, added: addedLines(dir),
      testsPass: tests.pass, acceptPass: accept.pass, done,
      reason: done ? '' : (!tests.pass ? 'fixture tests red' : accept.reason),
    };
    console.log(`    ${task.id} ${withRules ? 'on ' : 'off'} t${trial}: ${cell.done ? 'DONE' : 'FAIL(' + cell.reason.slice(0, 60) + ')'} — ${cell.turns} turns, ${(cell.ms / 1000).toFixed(0)}s, $${cell.cost.toFixed(3)}, +${cell.added} loc, out ${cell.output}`);
    return cell;
  } finally {
    // The agent may leave its own `node server.js` running in the workspace
    // (it started one to test its endpoint) — that grandchild holds the dir on
    // Windows. Cleanup is best-effort: a leaked temp dir is acceptable debris,
    // killing a paid run over rmdir is not.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    } catch {
      leftovers.push(dir);
      console.log(`    (workspace ${path.basename(dir)} left behind — locked by an agent-spawned process)`);
    }
  }
}
const leftovers = [];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// --only=<id> runs a single ticket (harness debugging / smoke tests).
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const tasks = fs.readFileSync(path.join(here, 'corpus', 'agentic-tasks.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  .filter((t) => !only || t.id === only);
for (const t of tasks) if (!AGENTIC_CHECKS[t.id]) { console.error(`no check for ${t.id}`); process.exit(1); }

console.log(`SHAMAN AGENTIC BENCH — ${tasks.length} tickets, model ${MODEL}, ${TRIALS} trials/arm, budget $${BUDGET_PER_SESSION}/session, tools ON\n`);

const rows = [];
let spend = 0;
for (const task of tasks) {
  console.log(`  == ${task.id}`);
  const cells = { off: [], on: [] };
  for (const arm of ['off', 'on']) {
    for (let k = 1; k <= TRIALS; k++) {
      const c = await runCell(task, arm === 'on', k);
      if (c.error) { console.log(`    ${task.id} ${arm} t${k}: ERROR ${c.error}`); continue; }
      cells[arm].push(c);
      spend += c.cost;
    }
  }
  if (!cells.off.length || !cells.on.length) continue;
  const agg = (arm) => ({
    done: mean(cells[arm].map((c) => (c.done ? 1 : 0))),
    cost: mean(cells[arm].map((c) => c.cost)),
    output: mean(cells[arm].map((c) => c.output)),
    total: mean(cells[arm].map((c) => c.input + c.output + c.cacheCreate)),
    cacheRead: mean(cells[arm].map((c) => c.cacheRead)),
    ms: mean(cells[arm].map((c) => c.ms)),
    turns: mean(cells[arm].map((c) => c.turns)),
    added: mean(cells[arm].map((c) => c.added)),
  });
  rows.push({ id: task.id, off: agg('off'), on: agg('on'), cells });
}

const pf = (x) => `${(x * 100).toFixed(0)}%`;
console.log(`\n  ${'ticket'.padEnd(15)}${'done off/on'.padStart(12)}${'cost off'.padStart(10)}${'cost on'.padStart(9)}${'out off'.padStart(9)}${'out on'.padStart(8)}${'+loc off/on'.padStart(13)}${'turns'.padStart(9)}`);
for (const r of rows) {
  console.log(`  ${r.id.padEnd(15)}${(pf(r.off.done) + '/' + pf(r.on.done)).padStart(12)}${('$' + r.off.cost.toFixed(3)).padStart(10)}${('$' + r.on.cost.toFixed(3)).padStart(9)}${r.off.output.toFixed(0).padStart(9)}${r.on.output.toFixed(0).padStart(8)}${(r.off.added.toFixed(0) + '/' + r.on.added.toFixed(0)).padStart(13)}${(r.off.turns.toFixed(1) + '/' + r.on.turns.toFixed(1)).padStart(9)}`);
}

const roll = (arm) => ({
  done: mean(rows.map((r) => r[arm].done)),
  cost: rows.reduce((a, r) => a + r[arm].cost, 0),
  output: rows.reduce((a, r) => a + r[arm].output, 0),
  total: rows.reduce((a, r) => a + r[arm].total, 0),
  cacheRead: rows.reduce((a, r) => a + r[arm].cacheRead, 0),
  ms: mean(rows.map((r) => r[arm].ms)),
  added: rows.reduce((a, r) => a + r[arm].added, 0),
});
const off = roll('off'), on = roll('on');

console.log(`\n  OVERALL completion off ${pf(off.done)} / on ${pf(on.done)}`);
console.log(`          session cost   $${off.cost.toFixed(3)} -> $${on.cost.toFixed(3)}  (${pf(1 - on.cost / off.cost)} saved)`);
console.log(`          output tokens  ${off.output.toFixed(0)} -> ${on.output.toFixed(0)}  (${pf(1 - on.output / off.output)})`);
console.log(`          total in+out+cacheW ${off.total.toFixed(0)} -> ${on.total.toFixed(0)}  (${pf(1 - on.total / off.total)})`);
console.log(`          cache reads    ${off.cacheRead.toFixed(0)} -> ${on.cacheRead.toFixed(0)}`);
console.log(`          diff size      +${off.added.toFixed(0)} -> +${on.added.toFixed(0)} loc`);
console.log(`          mean session   ${(off.ms / 1000).toFixed(0)}s -> ${(on.ms / 1000).toFixed(0)}s`);
console.log(`          bench spend    $${spend.toFixed(2)}`);

fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'agentic.json'),
  JSON.stringify({ model: MODEL, trials: TRIALS, rows, off, on, spendUsd: spend }, null, 2));
console.log(`\nwrote bench/results/agentic.json`);

// Second cleanup pass: agent-spawned servers are dead by now.
for (const dir of leftovers) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
}
