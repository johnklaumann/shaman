#!/usr/bin/env node
// UserPromptSubmit hook: score the prompt before it reaches the model.
//
// Outcomes (bands come from src/lib/score.js — one engine for hook, command, CLI):
//   exempt / strong        -> exit 0, no output (zero overhead)
//   weak + gate=confirm    -> exit 2, agent paused: scorecard + a preview of the
//                             context that will be added; resend to proceed (default)
//   weak + gate=coach      -> exit 2, blocked with the scorecard + a rewrite example
//   weak/medium + enrich   -> exit 0 + additionalContext (silent enrich)
//   medium + confirm/coach -> exit 0 + additionalContext (silent enrich)
// A block (confirm or coach) fires at most once per 3 min per session; the resend
// then falls through to enrich — so confirm's "resend to proceed" always lands.
//
// Questions are conversation — enriched at most, never blocked.
//
// UserPromptSubmit cannot rewrite the prompt (per Claude Code docs) — it can only
// block or inject context alongside it. Both are enough.
'use strict';
const { loadState, writeState, pruneSessions, effectiveMode, readStdin } = require('../lib/state');
const { score, renderCard, QUESTION } = require('../lib/score');

const COOLDOWN_MS = 3 * 60 * 1000;
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

const coachMessage = (r) => `${renderCard(r, {
  title: `SHAMAN GATE — prompt scored ${r.score}/100 (weak). Blocked before burning tokens.`,
})}

Resend like: "Fix token expiry check in auth/middleware.ts — expired tokens still pass. Must reject with 401, keep refresh flow working."

Gate modes: /shaman-gate confirm | coach | enrich | off · score without sending: /shaman-score`;

const enrichContext = (r) => `shaman gate: user prompt scored ${r.score}/100 (${r.band}). Missing: ${r.missing.map((m) => m.name).join(', ')}. Before acting: (1) state your assumptions as one short list; (2) if a material ambiguity remains, ask exactly one clarifying question and wait for the answer; (3) apply the decision ladder; (4) build the minimum that meets the stated goal. Do not expand scope beyond what was asked.`;

const confirmMessage = (r) => `${renderCard(r, {
  title: `SHAMAN GATE — prompt scored ${r.score}/100 (${r.band}). Paused to strengthen it before spending tokens.`,
})}

Context I'll add to strengthen your prompt:
  ${enrichContext(r)}

-> Resend (press up-arrow, then Enter) to PROCEED with this context added.
-> Or rewrite the prompt, filling the gaps above.

Skip the pause: /shaman-gate enrich (silent) · disable the gate: /shaman-gate off`;

function emitEnrich(r) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: enrichContext(r) }
  }));
}

try {
  const input = readStdin();
  const prompt = (input.prompt || '').trim();
  const { state } = loadState();

  // Mode switches typed as slash commands: persist here so the change survives
  // even before the command's markdown runs. A mid-session mode change marks the
  // session 'mixed' so bench comparisons exclude it.
  const modeCmd = prompt.match(/^\/(?:shaman:)?shaman\s+(lite|full|ultra|ab|off)\b/i);
  const gateCmd = prompt.match(/^\/(?:shaman:)?shaman-gate\s+(coach|enrich|confirm|off)\b/i);
  if (modeCmd || gateCmd) {
    const sessions = pruneSessions(state.sessions);
    const cur = sessions[input.session_id];
    const next = { ...state, sessions };
    if (modeCmd) {
      next.mode = modeCmd[1].toLowerCase();
      if (cur && cur.mode !== next.mode) sessions[input.session_id] = { ...cur, mode: 'mixed' };
    } else {
      next.gate = gateCmd[1].toLowerCase();
      if (cur) sessions[input.session_id] = { ...cur, gate: next.gate };
    }
    writeState(next);
    process.exit(0);
  }

  if (state.gate === 'off') process.exit(0);
  // ab off-day: the whole plugin is off — no enrichment either, or the
  // "vanilla" arm of the A/B would be contaminated by injected context.
  if (state.mode === 'ab' && effectiveMode(state.mode) === 'off') process.exit(0);
  if (prompt.startsWith('/')) process.exit(0); // never gate slash commands

  const r = score(prompt);
  if (r.exempt || r.band === 'strong') process.exit(0);

  // Questions are conversation — enrich at most, never block.
  if (QUESTION.test(prompt)) {
    if (r.band === 'weak') emitEnrich(r);
    process.exit(0);
  }

  const now = Date.now();
  const blocks = {};
  const cutoff = now - BLOCK_TTL_MS;
  for (const [id, ts] of Object.entries(state.blocks || {})) {
    if (ts > cutoff) blocks[id] = ts;
  }
  const blockedRecently = blocks[input.session_id] && now - blocks[input.session_id] < COOLDOWN_MS;

  const blockingGate = state.gate === 'coach' || state.gate === 'confirm';
  if (r.band === 'weak' && blockingGate && !blockedRecently) {
    blocks[input.session_id] = now;
    writeState({ ...state, blocks });
    process.stderr.write(state.gate === 'confirm' ? confirmMessage(r) : coachMessage(r));
    process.exit(2);
  }

  // medium, or weak within cooldown, or enrich mode: inject context, never block
  emitEnrich(r);
  process.exit(0);
} catch {
  process.exit(0); // gate must never break a prompt on its own errors
}
