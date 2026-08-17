#!/usr/bin/env node
// Stop hook: snapshot per-session token totals from the transcript JSONL.
//
// One API response is persisted as one transcript entry PER CONTENT BLOCK, each
// repeating the same usage object — summing naively overcounts ~3x. Dedupe by
// requestId. Appends a cumulative snapshot per Stop; readers keep the last
// record per session. Mode/gate come from the per-session record written at
// SessionStart (or 'mixed' after a mid-session switch), not from the global
// state, so a switch in another window can't relabel this session's numbers.
// Transcript format is internal to Claude Code and may change between versions —
// treat numbers as estimates, /usage is the source of truth.
'use strict';
const fs = require('node:fs');
const { loadState, benchPath, shamanDir, effectiveMode, readStdin } = require('../lib/state');

try {
  const input = readStdin();
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) process.exit(0);

  const { state } = loadState();
  const session = (state.sessions || {})[input.session_id];
  const seen = new Set();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let userTurns = 0;

  for (const line of fs.readFileSync(input.transcript_path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'user' && !entry.isSidechain && !entry.toolUseResult) userTurns++;

    if (entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    const id = entry.requestId || entry.message?.id || entry.uuid;
    if (seen.has(id)) continue;
    seen.add(id);

    totals.input += usage.input_tokens || 0;
    totals.output += usage.output_tokens || 0;
    totals.cacheRead += usage.cache_read_input_tokens || 0;
    totals.cacheCreation += usage.cache_creation_input_tokens || 0;
  }

  const record = {
    ts: new Date().toISOString(),
    session: input.session_id || null,
    mode: session ? session.mode : effectiveMode(state.mode),
    gate: session ? session.gate : state.gate,
    requests: seen.size,
    userTurns,
    ...totals,
  };

  fs.mkdirSync(shamanDir(), { recursive: true });
  fs.appendFileSync(benchPath(), JSON.stringify(record) + '\n');
  process.exit(0);
} catch {
  process.exit(0); // benchmarking must never block a session from stopping
}
