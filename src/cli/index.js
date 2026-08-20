#!/usr/bin/env node
'use strict';
// shaman CLI — the plugin's brain, usable from any tool with any model:
//   npx shaman-ai score "your prompt"   score a prompt before spending tokens
//   npx shaman-ai init [--force]        write shaman rule files for 8+ tools into this repo
//   npx shaman-ai bench                 per-session token report (Claude Code sessions)
// Zero dependencies. Exit codes: score -> 0 strong/medium, 2 weak (scriptable).
const fs = require('node:fs');
const path = require('node:path');
const { score, renderCard } = require('../lib/score');
const { render } = require('../lib/adapters');
const { benchPath, shamanDir } = require('../lib/state');

const HELP = `shaman — terse talk, minimal code, scored prompts

usage:
  shaman score "<prompt>"    score 0-100 with breakdown (exit 2 if weak)
  shaman init [--force]      generate rule files for Cursor, Copilot, Windsurf,
                             Cline, Kiro, Qoder, Codex/Gemini (AGENTS.md) here
  shaman bench               aggregate per-session token stats (Claude Code)
  shaman help                this card`;

function cmdScore(args) {
  const prompt = args.filter((a) => !a.startsWith('-')).join(' ').trim();
  if (!prompt) { console.error('usage: shaman score "<prompt>"'); process.exit(1); }
  const r = score(prompt);
  if (r.exempt) {
    const kinds = { ack: 'acknowledgements', slash: 'slash commands', conversation: 'conversation' };
    console.log(`not scored (${r.exempt}) — gate never touches ${kinds[r.exempt]}.`);
    return;
  }
  const label = { weak: 'weak — would pause for confirmation (default), or block in coach mode', medium: 'medium — would pass, enriched', strong: 'strong — passes silently' }[r.band];
  console.log(renderCard(r, { title: `score ${r.score}/100 · ${label}` }));
  if (r.isQuestion) console.log('\n  (question — never blocked, enriched at most)');
  if (r.band === 'weak') process.exit(2);
}

function cmdInit(args) {
  const force = args.includes('--force');
  const cwd = process.cwd();
  let wrote = 0, skipped = 0;
  for (const { tool, file, content } of render()) {
    const dest = path.join(cwd, file);
    if (fs.existsSync(dest) && !force) {
      console.log(`skip  ${file}  (exists — use --force to overwrite)  [${tool}]`);
      skipped++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log(`wrote ${file}  [${tool}]`);
    wrote++;
  }
  console.log(`\n${wrote} written, ${skipped} skipped. Rules are static for these tools; the prompt gate and per-session bench need hooks (Claude Code / Codex plugin).`);
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Convergence — exploration before the first edit, the retrieval/scout target.
// Only edit-sessions that recorded the field (post-instrumentation); median
// resists the mega-session skew that made pooled token numbers unreliable.
function printConvergence(groups) {
  const conv = Object.entries(groups)
    .map(([key, rs]) => [key, rs.filter((r) => r.sawEdit && typeof r.callsBeforeFirstEdit === 'number')])
    .filter(([, rs]) => rs.length);
  if (!conv.length) return;
  console.log('\n  convergence (edit sessions) — median tool calls before first edit');
  console.log('  mode  sessions   calls  explore  readTok');
  for (const [key, rs] of conv) {
    console.log(`  ${key.padEnd(4)}  ${String(rs.length).padStart(8)}  ${String(median(rs.map((r) => r.callsBeforeFirstEdit))).padStart(6)}  ${String(median(rs.map((r) => r.exploreCalls))).padStart(7)}  ${String(median(rs.map((r) => r.readTokens))).padStart(7)}`);
  }
  console.log('  (baseline for retrieval/scout — on should fall below off once code_search lands)');
}

// Gate router telemetry from gate.jsonl — the gate's own effectiveness.
function printGateStats() {
  let gate = [];
  try {
    gate = fs.readFileSync(path.join(shamanDir(), 'gate.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {}
  if (!gate.length) return;
  const byBand = {}, byAction = {}, bySess = {};
  for (const g of gate) {
    byBand[g.band] = (byBand[g.band] || 0) + 1;
    byAction[g.action] = (byAction[g.action] || 0) + 1;
    bySess[g.session] ||= [];
    bySess[g.session].push(g);
  }
  let pauses = 0, proceeded = 0;
  for (const arr of Object.values(bySess)) {
    arr.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    arr.forEach((g, i) => {
      if (g.action !== 'pause') return;
      pauses++;
      if (arr.slice(i + 1).some((x) => x.action === 'enrich')) proceeded++;
    });
  }
  console.log(`\n  gate (router telemetry) — ${gate.length} scored prompts`);
  console.log('  bands:   ' + Object.entries(byBand).map(([b, c]) => `${b} ${Math.round((100 * c) / gate.length)}%`).join(' · '));
  console.log('  actions: ' + Object.entries(byAction).map(([a, c]) => `${a} ${c}`).join(' · '));
  if (pauses) console.log(`  confirm proceed-rate: ${Math.round((100 * proceeded) / pauses)}% (${proceeded}/${pauses} pauses later resent — proxy)`);
}

function cmdBench() {
  let lines;
  try {
    lines = fs.readFileSync(benchPath(), 'utf8').split('\n').filter((l) => l.trim());
  } catch {
    console.log('no benchmarks yet — they appear after the first completed Claude Code session with shaman installed.');
    return;
  }
  const bySession = new Map();
  for (const line of lines) {
    try { const r = JSON.parse(line); bySession.set(r.session, r); } catch {}
  }
  const groups = {};
  let mixed = 0;
  for (const r of bySession.values()) {
    if (r.mode === 'mixed') { mixed++; continue; }
    const key = r.mode === 'off' ? 'off' : 'on';
    (groups[key] ||= []).push(r);
  }
  console.log(`sessions: ${bySession.size} (${mixed} mixed excluded)\n`);
  console.log('  mode  sessions  requests   out/req   in/req');
  for (const [key, rs] of Object.entries(groups)) {
    const sum = (f) => rs.reduce((a, r) => a + (r[f] || 0), 0);
    const reqs = sum('requests') || 1;
    console.log(`  ${key.padEnd(4)}  ${String(rs.length).padStart(8)}  ${String(sum('requests')).padStart(8)}  ${String(Math.round(sum('output') / reqs)).padStart(8)}  ${String(Math.round(sum('input') / reqs)).padStart(7)}`);
  }
  const [on, off] = [groups.on, groups.off];
  if (on?.length && off?.length) {
    const rate = (rs) => rs.reduce((a, r) => a + r.output, 0) / (rs.reduce((a, r) => a + r.requests, 0) || 1);
    const diff = 1 - rate(on) / rate(off);
    console.log(`\n  output tokens per request, on vs off: ${(diff * 100).toFixed(1)}% ${diff >= 0 ? 'lower' : 'HIGHER'}`);
  }

  printConvergence(groups);
  printGateStats();

  console.log('\n  estimates from transcripts — /usage is the source of truth; compare similar tasks only.');
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'score': cmdScore(args); break;
  case 'init': cmdInit(args); break;
  case 'bench': cmdBench(); break;
  case 'help': case undefined: case '--help': case '-h': console.log(HELP); break;
  default: console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(1);
}
