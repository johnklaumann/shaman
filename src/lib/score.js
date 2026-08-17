'use strict';
// Prompt scoring engine — pure functions, no I/O, no API calls.
//
// score(prompt) returns a 0–100 score with a per-dimension breakdown, a band
// (weak/medium/strong), and concrete suggestions. The gate hook, the
// /shaman-score command, and the CLI all render from this one result, so the
// number a user sees is always computed the same way.
//
// Dimensions (max 100):
//   target      30  names a file, function, path, backticked code, or error text
//   action      20  contains an action verb (EN + PT conjugation-aware stems)
//   constraint  20  states a requirement or acceptance criterion
//   context     15  describes current vs expected behavior, or enough words to carry it
//   detail      15  specificity signals: numbers, quoted strings, extra code refs
//
// Bands are structural, not just numeric — a prompt that names both a target
// and an action is workable even when short ("update README.md with steps"),
// so target+action promotes to strong regardless of score:
//   weak    known vague phrase, or score < 20
//   strong  (target && action) or score >= 70
//   medium  everything between
//
// Exemptions (never scored): slash commands, acknowledgements, questions,
// and prompts with neither an action verb nor a code target — that's
// conversation, not a task.

// Lexicons as arrays: easy to extend per language. Short stems get bounded
// conjugation shapes so English words don't match them ('critical' !~ cri,
// 'address' !~ add, 'muddy' !~ mud, 'testimony' !~ test).
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
  String.raw`\bmigr(?:a|e|o|ar|ou|am|em|ando)\b`,
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

// Current-vs-expected signals: a short prompt that states both sides of the bug
// carries real context even under 15 words.
const BEHAVIOR_SIGNALS = new RegExp([
  String.raw`\b(?:currently|expected|instead of|should be|used to|but (?:now|it)|still|regression)\b`,
  String.raw`\b(?:atualmente|esperado|deveria|em vez de|antes (?:era|funcionava)|mas (?:agora|ele)|ainda)\b`,
].join('|'), 'i');

const NUMBERS = /\b\d+(?:\.\d+)?\b/;
const QUOTED = /"[^"]{2,}"|'[^']{2,}'/;

// Questions are NOT exempt here: a weak question still gets enriched by the
// gate (never blocked), so score() reports isQuestion and the caller decides.
function classifyExempt(prompt) {
  if (prompt.startsWith('/')) return 'slash';
  if (VAGUE_ONLY.test(prompt)) return null; // vague task phrases outrank conversational shapes
  if (ACK.test(prompt)) return 'ack';
  if (!ACTION_VERBS.test(prompt) && !CODE_REF.test(prompt)) return 'conversation';
  return null;
}

function contextPts(hasBehavior, words) {
  if (hasBehavior || words >= 15) return 15;
  return words >= 8 ? 7 : 0;
}

function detailPts(hits) {
  if (hits >= 2) return 15;
  return hits === 1 ? 8 : 0;
}

function score(promptRaw) {
  const prompt = (promptRaw || '').trim();
  const exempt = classifyExempt(prompt);
  const words = prompt.split(/\s+/).filter(Boolean).length;

  const hasTarget = CODE_REF.test(prompt);
  const hasVerb = ACTION_VERBS.test(prompt);
  const hasConstraint = CONSTRAINTS.test(prompt);
  const hasBehavior = BEHAVIOR_SIGNALS.test(prompt);

  // detail: count independent specificity signals
  let detailHits = 0;
  if (NUMBERS.test(prompt)) detailHits++;
  if (QUOTED.test(prompt)) detailHits++;
  const refMatches = prompt.match(new RegExp(CODE_REF.source, 'g')) || [];
  if (refMatches.length >= 2) detailHits++;

  const dims = {
    target: {
      pts: hasTarget ? 30 : 0, max: 30,
      note: hasTarget ? 'file / function / error named' : 'name a file, function, or paste the error text',
    },
    action: {
      pts: hasVerb ? 20 : 0, max: 20,
      note: hasVerb ? 'action verb present' : 'say what to do: fix / add / refactor / remove...',
    },
    constraint: {
      pts: hasConstraint ? 20 : 0, max: 20,
      note: hasConstraint ? 'acceptance criteria present' : 'add "must / should / keep / without..." criteria',
    },
    context: {
      pts: contextPts(hasBehavior, words), max: 15,
      note: hasBehavior || words >= 15 ? 'behavior described' : 'describe current vs expected behavior',
    },
    detail: {
      pts: detailPts(detailHits), max: 15,
      note: detailHits ? 'specifics present' : 'add specifics: numbers, names, exact messages',
    },
  };

  const total = Object.values(dims).reduce((a, d) => a + d.pts, 0);
  const vague = VAGUE_ONLY.test(prompt);

  let band = 'medium';
  if (vague || total < 20) band = 'weak';
  else if ((hasTarget && hasVerb) || total >= 70) band = 'strong';

  const missing = Object.entries(dims)
    .filter(([, d]) => d.pts < d.max)
    .map(([name, d]) => ({ name, note: d.note }));

  return { prompt, words, exempt, vague, isQuestion: QUESTION.test(prompt), score: total, band, dims, missing };
}

// Compact ASCII scorecard shared by the gate block message, /shaman-score and
// the CLI. width=6 keeps the card narrow enough for hook stderr rendering.
function renderCard(result, { title } = {}) {
  const bar = (pts, max) => {
    const fill = Math.round((pts / max) * 6);
    return '█'.repeat(fill) + '░'.repeat(6 - fill);
  };
  const lines = [];
  if (title) lines.push(title, '');
  for (const [name, d] of Object.entries(result.dims)) {
    lines.push(`  ${name.padEnd(11)}${bar(d.pts, d.max)} ${String(d.pts).padStart(2)}/${d.max}   ${d.note}`);
  }
  return lines.join('\n');
}

module.exports = {
  score, renderCard,
  ACTION_VERBS, CONSTRAINTS, CODE_REF, VAGUE_ONLY, ACK, QUESTION,
};
