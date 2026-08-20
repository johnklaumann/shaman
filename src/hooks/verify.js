#!/usr/bin/env node
// Stop hook: verify the agent's "done" against reality. When a session edited
// code AND the agent's final message claims completion, run the repo's checks
// (opt-in via .shaman.json) and scan the edited files for high-severity security
// issues. A claim contradicted by a red check or a real finding is BLOCKED
// (exit 2) — the agent is handed the evidence and keeps working instead of
// reporting done. This is deterministic (run tests, read exit codes; regex the
// diff) — not a nudge, not an adoption bet: the harness verifies the agent.
//
// Conservative by design: silent unless the agent explicitly claims done; WIP
// ("still failing", "next step") never blocks; findings in test files never
// block; each distinct issue is confronted at most once per session (dedupe);
// checks run only when configured. Fail-open — a verify error never blocks Stop.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadState, writeState, shamanDir, effectiveMode, readStdin } = require('../lib/state');
const { scanContent } = require('../lib/scan');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CLAIM = /\b(done|completed?|finished|works|working|ready|passing|fixed|implemented|shipped|pronto|conclu[ií]\w*|finalizad\w*|funciona\w*|resolvid\w*|corrigid\w*)\b/i;
const NOT_DONE = /\b(wip|todo|fixme|failing|fails|broken|incomplete|partial|still|next step|remaining|not (?:yet|working)|doesn'?t work|falha\w*|quebrad\w*|incomplet\w*|parcial|ainda|n[aã]o funciona\w*|pr[oó]xim\w*)\b/i;
const CHECK_TIMEOUT_MS = 90000;
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

function collect(transcriptPath) {
  const edited = new Set();
  let lastText = '';
  for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || e.type !== 'assistant') continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    let txt = '';
    for (const b of content) {
      if (b.type === 'tool_use' && EDIT_TOOLS.has(b.name) && b.input?.file_path) edited.add(b.input.file_path);
      else if (b.type === 'text' && b.text) txt += b.text + '\n';
    }
    if (txt.trim()) lastText = txt; // last non-empty assistant text = the claim
  }
  return { edited: [...edited], lastText };
}

function scanEdited(edited) {
  const findings = [];
  for (const fp of edited) {
    let content;
    try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    if (content.includes(String.fromCodePoint(0))) continue;
    findings.push(...scanContent(fp, content));
  }
  return findings;
}

function runChecks(checks, cwd) {
  return checks.map((cmd) => {
    const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const exit = typeof r.status === 'number' ? r.status : -1; // null = timeout/kill/spawn error
    return { cmd, exit, ok: exit === 0 };
  });
}

function logVerify(rec) {
  try {
    fs.mkdirSync(shamanDir(), { recursive: true });
    fs.appendFileSync(path.join(shamanDir(), 'verify.jsonl'), JSON.stringify(rec) + '\n');
  } catch { /* telemetry best-effort */ }
}

try {
  const input = readStdin();
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) process.exit(0);
  const { state } = loadState();
  if (state.verify === 'off') process.exit(0);
  if (state.mode === 'ab' && effectiveMode(state.mode) === 'off') process.exit(0);
  if (input.stop_hook_active) process.exit(0); // loop guard: never re-verify our own continuation

  const cwd = input.cwd || process.cwd();
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.shaman.json'), 'utf8')).verify || {}; } catch { /* no config */ }
  if (cfg.off) process.exit(0);

  const { edited, lastText } = collect(input.transcript_path);
  if (!edited.length) process.exit(0); // nothing changed → nothing to verify

  const claim = CLAIM.test(lastText) && !NOT_DONE.test(lastText);
  const findings = scanEdited(edited);
  const highNonTest = findings.filter((f) => f.sev === 'high' && !f.test);
  const checks = (claim && Array.isArray(cfg.checks)) ? runChecks(cfg.checks, cwd) : [];
  const red = checks.filter((c) => !c.ok);

  // dedupe: confront each distinct issue at most once per session
  const now = Date.now();
  const vb = {};
  for (const [id, r] of Object.entries(state.verifyBlocks || {})) if (r && r.ts > now - BLOCK_TTL_MS) vb[id] = r;
  const prior = new Set(vb[input.session_id]?.sigs || []);
  const newFindings = highNonTest.filter((f) => !prior.has(`f:${f.file}:${f.line}:${f.id}`));
  const newRed = red.filter((c) => !prior.has(`c:${c.cmd}`));
  const block = claim && (newFindings.length > 0 || newRed.length > 0);

  logVerify({
    ts: new Date().toISOString(), session: input.session_id || null, repo: path.basename(cwd),
    edited: edited.length, claim,
    checks: checks.map((c) => ({ cmd: c.cmd, exit: c.exit })),
    findings: findings.map((f) => ({ file: path.basename(f.file), line: f.line, id: f.id, sev: f.sev, test: f.test })),
    blocked: block,
  });

  if (!block) process.exit(0);

  const sigs = [...prior, ...newFindings.map((f) => `f:${f.file}:${f.line}:${f.id}`), ...newRed.map((c) => `c:${c.cmd}`)];
  vb[input.session_id] = { sigs, ts: now };
  writeState({ ...state, verifyBlocks: vb });

  const lines = ['SHAMAN VERIFY — you reported completion, but reality disagrees:'];
  for (const c of newRed) lines.push(`  x check failed: ${c.cmd} (exit ${c.exit})`);
  for (const f of newFindings) lines.push(`  x ${f.sev} security: ${f.msg} — ${path.basename(f.file)}:${f.line}`);
  lines.push('Fix these, or state explicitly what is incomplete and why — do not report done while checks are red or secrets are hardcoded.');
  process.stderr.write(lines.join('\n'));
  process.exit(2);
} catch {
  process.exit(0); // verify must never break a session from stopping
}
