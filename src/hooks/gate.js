#!/usr/bin/env node
// UserPromptSubmit hook: score the prompt before it reaches the model.
//
// Outcomes:
//   strong prompt        -> exit 0, no output (zero overhead)
//   weak + gate=coach    -> exit 2, prompt blocked BEFORE any tokens are spent,
//                           stderr shows what to add (once per 3 min per session)
//   weak/medium + enrich -> exit 0 + additionalContext telling the model to state
//                           assumptions and ask at most one clarifying question
//
// Never gated: slash commands, acknowledgements, questions (enriched at most),
// and anything with neither an action verb nor a code/file reference — a prompt
// that names no action and no target is conversation, not a task.
//
// UserPromptSubmit cannot rewrite the prompt (per Claude Code docs) — it can only
// block or inject context alongside it. Both are enough.
'use strict';
const { loadState, writeState, pruneSessions, readStdin } = require('../lib/state');

const COOLDOWN_MS = 3 * 60 * 1000;
const BLOCK_TTL_MS = 24 * 60 * 60 * 1000;

// Lexicons as arrays: easy to extend, and short stems get bounded conjugation
// shapes so English words don't match them ('critical' !~ cri, 'address' !~ add,
// 'muddy' !~ mud, 'testimony' !~ test).
const VERB_PATTERNS = [
  String.raw`\b(?:fix|creat|implement|refactor|remov|delet|updat|renam|migrat|build|debug|deploy|install|configur|improv|simplif|check|verif|revis|review|execut|arrum|corrig|consert|adicion|refator|renomei|atualiz|otimiz|escrev|ajust|melhor|desenvolv)\w*\b`,
  String.raw`\badd(?:s|ed|ing)?\b`,
  String.raw`\bwrit(?:e|es|ing|ten)\b`,
  String.raw`\bwrote\b`,
  String.raw`\bbuilt\b`,
  String.raw`\brun(?:s|ning)?\b`,
  String.raw`\btest(?:s|ed|ing|a|e|ar|ou|ando)?\b`,
  String.raw`\boptimi[sz]\w*\b`,
  String.raw`\bmud(?:a|e|ar|ou|ando)\b`,
  String.raw`\bcri(?:a|e|ar|ou|ando)\b`,
  String.raw`\bgerar?\b`,
];
const ACTION_VERBS = new RegExp(VERB_PATTERNS.join('|'), 'i');

const CONSTRAINT_WORDS = [
  'should', 'must', 'without', 'only', 'except', 'when', 'unless', 'expect', 'accept', 'keep', 'preserve',
  'deve', 'devem', 'sem', 'apenas', 'somente', 'quando', 'exceto', 'mantendo', 'manter', 'crit[eé]rio',
];
const CONSTRAINTS = new RegExp(String.raw`\b(?:${CONSTRAINT_WORDS.join('|')})\b`, 'i');

// Backticked code, file.ext, multi-segment paths, path/file.ext, snake_case,
// camelCase, call() or error words. Shapes chosen so plain English ('e.g.',
// 'and/or', '24/7') does not count as a code target.
const CODE_REF_PARTS = [
  '`[^`]+`',
  String.raw`\b[\w-]+\.(?:m?[jt]sx?|py|rb|go|rs|java|kt|cs|cpp|hpp|cc|c|h|php|sql|sh|ps1|md|json|jsonc|ya?ml|toml|xml|html?|css|scss|vue|svelte|env|cfg|ini|txt|csv|lock|tf|proto)\b`,
  String.raw`(?:[\w.-]+[/\\]){2,}[\w.-]+`,
  String.raw`\b[\w-]+[/\\][\w-]+\.\w{1,5}\b`,
  String.raw`\b[a-z]+_[a-z]\w*\b`,
  String.raw`\b[a-z]+[A-Z]\w*\b`,
  String.raw`\w+\(\)`,
  String.raw`\b[Ee]rror\b`,
  String.raw`\b[Ee]xception\b`,
  String.raw`\berro\b`,
  String.raw`\btraceback\b`,
];
const CODE_REF = new RegExp(CODE_REF_PARTS.join('|'));

const VAGUE_PHRASES = [
  'fix (?:it|this)', String.raw`it (?:doesn'?t|does not|won'?t) work`, '(?:this |it )?(?:is )?broken',
  'make it (?:better|work|faster)', 'improve(?: this| it)?', 'clean(?: this| it)? up', 'optimi[sz]e(?: this| it)?',
  'arruma(?: isso| isto)?', 'conserta(?: isso| isto)?', String.raw`n[aã]o (?:funciona|est[aá] funcionando)`,
  String.raw`(?:es)?t[aá] quebrado`, 'melhora(?: isso| isto)?', 'deixa melhor', 'otimiza(?: isso| isto)?', 'faz funcionar',
];
const VAGUE_ONLY = new RegExp(`^(?:${VAGUE_PHRASES.join('|')})[.!]?$`, 'i');

// Prefix match: "sounds good, go ahead" is an approval even with a tail.
const ACK_STARTS = [
  'y', 'yes', 'yep', 'yeah', 'no', 'nope', 'ok', 'okay', 'sure', 'sounds good', 'looks good', 'lgtm',
  'perfect', 'great', 'nice', 'go ahead', 'go', 'do it', 'proceed', 'continue', 'thanks', 'thank you',
  'stop', 'wait', 'hold on', 'sim', 'n[aã]o', 'pode(?: ser)?', 'beleza', 'blz', 'show', 'top',
  'perfeito', '[oó]timo', 'boa', 'isso', 'vai', 'continua', 'segue', 'faz', 'obrigad[oa]', 'valeu', 'para', 'pera',
];
const ACK = new RegExp(String.raw`^(?:${ACK_STARTS.join('|')})\b`, 'i');

// Trailing '?' OR leading interrogative — many people skip the question mark.
const QUESTION_STARTS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'could', 'should', 'would', 'will',
  'does', 'do', 'did', 'is', 'are', 'was', 'were',
  'o que', 'por ?qu[eê]', 'como', 'quando', 'onde', 'quem', 'qual', 'quais', 'ser[aá]',
  '[eé] poss[ií]vel', 'tem como', 'd[aá] p(?:a)?ra',
];
const QUESTION = new RegExp(String.raw`\?\s*$|^(?:${QUESTION_STARTS.join('|')})\b`, 'i');

function analyze(prompt) {
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const hasTarget = CODE_REF.test(prompt);
  const hasVerb = ACTION_VERBS.test(prompt);
  const hasConstraint = CONSTRAINTS.test(prompt);

  const missing = [];
  if (!hasTarget) missing.push('target (file/function/error text)');
  if (!hasConstraint) missing.push('constraint or acceptance criteria');
  if (words < 12) missing.push('context (current vs expected behavior)');

  let level = 'strong';
  if (VAGUE_ONLY.test(prompt)) level = 'weak';
  else if (words < 8 && !hasTarget && !hasConstraint) level = hasVerb ? 'medium' : 'weak';
  else if (!hasTarget && !hasConstraint && words < 15) level = 'medium';

  return { level, missing };
}

const COACH_TEMPLATE = (missing) => `SHAMAN GATE — prompt too vague. Blocked before burning tokens.

Missing: ${missing.join(', ')}

Resend with:
  goal:    what change, where (file / function / error)
  context: current behavior vs expected
  accept:  how you'll know it's done

Example: "Fix token expiry check in auth/middleware.ts — expired tokens still pass. Must reject with 401, keep refresh flow working."

Gate modes: /shaman-gate coach | enrich | off`;

const ENRICH_CONTEXT = (missing) => `shaman gate: user prompt is underspecified (missing: ${missing.join(', ')}). Before acting: (1) state your assumptions as one short list; (2) if a material ambiguity remains, ask exactly one clarifying question and wait for the answer; (3) apply the decision ladder; (4) build the minimum that meets the stated goal. Do not expand scope beyond what was asked.`;

function emitEnrich(missing) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ENRICH_CONTEXT(missing) }
  }));
}

try {
  const input = readStdin();
  const prompt = (input.prompt || '').trim();
  const { state } = loadState();

  // Mode switches typed as slash commands: persist here so the change survives
  // even before the command's markdown runs. A mid-session mode change marks the
  // session 'mixed' so bench comparisons exclude it.
  const modeCmd = prompt.match(/^\/(?:shaman:)?shaman\s+(lite|full|ultra|off)\b/i);
  const gateCmd = prompt.match(/^\/(?:shaman:)?shaman-gate\s+(coach|enrich|off)\b/i);
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
  if (prompt.startsWith('/')) process.exit(0); // never gate slash commands

  // Known vague-task phrases ("não funciona", "faz funcionar") are checked before
  // the conversational bypasses — several start with words that also open
  // acknowledgements ("não", "faz").
  const isVague = VAGUE_ONLY.test(prompt);
  if (!isVague) {
    if (ACK.test(prompt)) process.exit(0);
    // No action verb and no code target: conversation, not a task.
    if (!ACTION_VERBS.test(prompt) && !CODE_REF.test(prompt)) process.exit(0);
  }

  const { level, missing } = analyze(prompt);
  if (level === 'strong') process.exit(0);

  // Questions are conversation — enrich at most, never block.
  if (QUESTION.test(prompt)) {
    if (level === 'weak') emitEnrich(missing);
    process.exit(0);
  }

  const now = Date.now();
  const blocks = {};
  const cutoff = now - BLOCK_TTL_MS;
  for (const [id, ts] of Object.entries(state.blocks || {})) {
    if (ts > cutoff) blocks[id] = ts;
  }
  const blockedRecently = blocks[input.session_id] && now - blocks[input.session_id] < COOLDOWN_MS;

  if (level === 'weak' && state.gate === 'coach' && !blockedRecently) {
    blocks[input.session_id] = now;
    writeState({ ...state, blocks });
    process.stderr.write(COACH_TEMPLATE(missing));
    process.exit(2);
  }

  // medium, or weak within cooldown / enrich mode
  emitEnrich(missing);
  process.exit(0);
} catch {
  process.exit(0); // gate must never break a prompt on its own errors
}
