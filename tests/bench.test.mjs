import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(root, 'src', 'hooks', 'bench.js');

// Assistant entry carrying usage + a single tool_use block.
const asst = (requestId, tool, usage) => JSON.stringify({
  type: 'assistant', requestId,
  message: { id: requestId, role: 'assistant', usage, content: [{ type: 'tool_use', id: 't-' + tool.id, name: tool.name, input: {} }] },
});
const toolResult = (id, text) => JSON.stringify({
  type: 'user', toolUseResult: { ok: true },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-' + id, content: text }] },
});
const userTurn = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const U = (out) => ({ input_tokens: 1, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 });

function runBench(transcriptLines, { sessionId = 's1', cwd = path.join(os.tmpdir(), 'myrepo') } = {}) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-bench-'));
  fs.mkdirSync(path.join(cfg, 'shaman'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'shaman', 'state.json'),
    JSON.stringify({ mode: 'ab', gate: 'confirm', sessions: { [sessionId]: { mode: 'full', gate: 'confirm', ts: Date.now() } } }));
  const tp = path.join(cfg, 'transcript.jsonl');
  fs.writeFileSync(tp, transcriptLines.join('\n') + '\n');
  const payload = { session_id: sessionId, transcript_path: tp };
  if (cwd) payload.cwd = cwd;
  const r = spawnSync('node', [BENCH], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const lines = fs.readFileSync(path.join(cfg, 'shaman', 'bench.jsonl'), 'utf8').split('\n').filter(Boolean);
  const rec = JSON.parse(lines[lines.length - 1]);
  fs.rmSync(cfg, { recursive: true, force: true });
  return rec;
}

test('convergence: counts explore/other calls before the first edit, stops at the edit', () => {
  const rec = runBench([
    userTurn('fix the bug'),                       // real user turn 1
    asst('r1', { id: 'grep', name: 'Grep' }, U(20)),
    toolResult('grep', 'a'.repeat(40)),            // explore result -> readTokens += 10
    asst('r2', { id: 'bash', name: 'Bash' }, U(30)),   // non-explore, still pre-edit
    toolResult('bash', 'x'.repeat(400)),           // Bash NOT counted in readTokens
    asst('r3', { id: 'read', name: 'Read' }, U(40)),
    toolResult('read', 'b'.repeat(80)),            // explore result -> readTokens += 20
    asst('r3', { id: 'read', name: 'Read' }, U(40)),   // dup requestId+tool id -> deduped
    asst('r4', { id: 'edit', name: 'Edit' }, U(50)),   // FIRST edit -> sawEdit
    asst('r5', { id: 'read2', name: 'Read' }, U(60)),  // explore AFTER edit -> not counted
    userTurn('thanks'),                            // real user turn 2
  ]);

  assert.equal(rec.userTurns, 2);
  assert.equal(rec.sawEdit, true);
  assert.equal(rec.callsBeforeFirstEdit, 3, 'Grep + Bash + Read before the Edit');
  assert.equal(rec.exploreCalls, 2, 'Grep + Read (Bash is not exploration)');
  assert.equal(rec.readTokens, 30, 'tk(40) + tk(80), Bash excluded');
  assert.equal(rec.requests, 5, 'r1..r5, duplicate r3 deduped');
  assert.equal(rec.output, 200, '20+30+40+50+60, dup counted once');
  assert.equal(rec.repo, 'myrepo');
  assert.equal(rec.mode, 'full');   // from the per-session record, not global 'ab'
  assert.equal(rec.gate, 'confirm');
});

test('convergence: a session that never edits reports sawEdit=false and counts all pre-edit calls', () => {
  const rec = runBench([
    userTurn('what does this do?'),
    asst('r1', { id: 'g', name: 'Grep' }, U(10)),
    asst('r2', { id: 'r', name: 'Read' }, U(10)),
  ]);
  assert.equal(rec.sawEdit, false);
  assert.equal(rec.callsBeforeFirstEdit, 2);
  assert.equal(rec.exploreCalls, 2);
});

test('sidechain (subagent) tool calls do not count toward main-chain convergence', () => {
  const side = JSON.stringify({
    type: 'assistant', requestId: 'rs', isSidechain: true,
    message: { id: 'rs', role: 'assistant', usage: U(5), content: [{ type: 'tool_use', id: 't-sg', name: 'Grep', input: {} }] },
  });
  const rec = runBench([
    userTurn('go'),
    side,                                           // subagent grep -> ignored
    asst('r1', { id: 'edit', name: 'Edit' }, U(20)),
  ]);
  assert.equal(rec.callsBeforeFirstEdit, 0, 'sidechain exploration excluded');
  assert.equal(rec.sawEdit, true);
});

test('missing cwd degrades to repo=null without throwing', () => {
  const rec = runBench([userTurn('hi'), asst('r1', { id: 'e', name: 'Edit' }, U(5))], { cwd: null });
  assert.equal(rec.repo, null);
});
