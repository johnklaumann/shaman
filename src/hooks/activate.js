#!/usr/bin/env node
// SessionStart + SubagentStart hook: inject the shaman ruleset as context.
// stdout on exit 0 becomes context Claude can see. Subagents get the same rules
// (a terse main agent with verbose subagents leaks the savings) but skip session
// bookkeeping — their token usage lands in the parent session's transcript.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadState, writeState, pruneSessions, readStdin } = require('../lib/state');

try {
  const input = readStdin();
  const { state, corrupt } = loadState();
  const isSubagent = input.hook_event_name === 'SubagentStart';

  // Record the mode this session starts under, so bench snapshots stay accurate
  // even if the global mode changes later from another window. Skip the write if
  // the state file is corrupt — never persist the DEFAULTS fallback over a file
  // the user may be able to recover.
  if (!corrupt && !isSubagent) {
    const sessions = pruneSessions(state.sessions);
    if (input.session_id && !sessions[input.session_id]) {
      sessions[input.session_id] = { mode: state.mode, gate: state.gate, ts: Date.now() };
    }
    writeState({ ...state, sessions });
  }

  if (state.mode === 'off') process.exit(0);

  let rules = fs.readFileSync(path.join(__dirname, '..', '..', 'rules', 'core.md'), 'utf8');

  if (state.mode === 'lite') {
    // lite keeps articles and full sentences; only filler dies.
    rules = rules.replace(/^- Drop articles.*\r?\n/m, '');
  } else if (state.mode === 'ultra') {
    rules = rules.replace(
      /^(- Drop articles.*)$/m,
      '$1\n- One word when one word enough. Strip conjunctions.'
    );
  }

  rules = rules.replace(
    /^# SHAMAN ACTIVE$/m,
    `# SHAMAN ACTIVE — level: ${state.mode}, gate: ${state.gate}`
  );

  process.stdout.write(rules);
  process.exit(0);
} catch {
  // Never break a session over a style ruleset.
  process.exit(0);
}
