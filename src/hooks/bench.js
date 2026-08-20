#!/usr/bin/env node
// Stop hook: snapshot per-session token totals + convergence metrics from the
// transcript JSONL.
//
// One API response is persisted as one transcript entry PER CONTENT BLOCK, each
// repeating the same usage object — summing usage naively overcounts ~3x, so
// dedupe by requestId. Tool-use and tool-result blocks are deduped independently
// by their own ids (a block can recur across split entries), so convergence
// counts stay exact no matter how the transcript is chunked.
//
// Convergence = how far the agent explores before it first edits. The token
// autopsy (bench/autopsy.mjs) showed exploration tool-results are the dominant
// context cost — Read alone ~57% of ingest, median ~19 tool calls before the
// first edit — and context (cacheRead+cacheWrite) is ~86% of cost, dwarfing
// output. Tracking convergence per session gives the live baseline the
// retrieval/scout work has to beat; a feature that doesn't move these numbers
// isn't paying for itself.
//
// Appends a cumulative snapshot per Stop; readers keep the last record per
// session. Mode/gate come from the per-session record written at SessionStart
// (or 'mixed' after a mid-session switch), not the global state. Transcript
// format is internal to Claude Code and may change between versions — treat
// numbers as estimates, /usage is the source of truth.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadState, benchPath, shamanDir, effectiveMode, readStdin } = require('../lib/state');

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'LS']);
const tk = (s) => Math.round((typeof s === 'string' ? s : '').length / 4); // char/4 token proxy

try {
  const input = readStdin();
  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) process.exit(0);

  const { state } = loadState();
  const session = state.sessions?.[input.session_id];

  const seen = new Set();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  let userTurns = 0;

  const toolName = new Map();
  const countedResult = new Set();
  let sawEdit = false, callsBeforeFirstEdit = 0, exploreCalls = 0, readTokens = 0;

  for (const line of fs.readFileSync(input.transcript_path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const side = entry.isSidechain === true;
    const content = entry.message?.content;

    if (entry.type === 'user') {
      if (!side && !entry.toolUseResult) userTurns++;
      if (Array.isArray(content)) for (const b of content) {
        if (b.type !== 'tool_result' || countedResult.has(b.tool_use_id)) continue;
        if (!EXPLORE.has(toolName.get(b.tool_use_id))) continue;
        countedResult.add(b.tool_use_id);
        readTokens += Array.isArray(b.content)
          ? b.content.reduce((n, c) => n + tk(c.text), 0)
          : tk(b.content);
      }
      continue;
    }

    if (entry.type !== 'assistant') continue;

    if (Array.isArray(content)) for (const b of content) {
      if (b.type !== 'tool_use' || toolName.has(b.id)) continue;
      toolName.set(b.id, b.name);
      if (side || sawEdit) continue;
      if (EDIT.has(b.name)) sawEdit = true;
      else { callsBeforeFirstEdit++; if (EXPLORE.has(b.name)) exploreCalls++; }
    }

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
    repo: input.cwd ? path.basename(input.cwd) : null,
    mode: session ? session.mode : effectiveMode(state.mode),
    gate: session ? session.gate : state.gate,
    requests: seen.size,
    userTurns,
    sawEdit,
    callsBeforeFirstEdit,
    exploreCalls,
    readTokens,
    ...totals,
  };

  fs.mkdirSync(shamanDir(), { recursive: true });
  fs.appendFileSync(benchPath(), JSON.stringify(record) + '\n');
  process.exit(0);
} catch {
  process.exit(0); // benchmarking must never block a session from stopping
}
