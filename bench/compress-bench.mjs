#!/usr/bin/env node
// Compression benchmark: measure how many OUTPUT tokens the shaman talk style saves
// on MATCHED-CONTENT response pairs — same technical facts, code, and numbers on
// both sides, only the prose style differs (default assistant prose vs shaman full).
//
// This measures the mechanism the "talk less" pillar controls: the shape of the
// prose. It is NOT a live end-to-end session delta — real per-session numbers depend
// on the task, model, and tool use, and only your own `/shaman-bench` can report them.
// The pairs live in corpus/pairs.jsonl, committed so anyone can judge fairness and
// re-measure. Token counts use tiktoken cl100k (OpenAI) as a proxy for Claude's
// tokenizer (not public) — expect within ~10-15%.
'use strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAIRS = path.join(here, 'corpus', 'pairs.jsonl');

// One python process tokenizes every string in a JSON array — avoids paying python
// startup per pair.
function tokenizeAll(strings) {
  const script = 'import sys,json,tiktoken\n' +
    'enc=tiktoken.get_encoding("cl100k_base")\n' +
    'print(json.dumps([len(enc.encode(s)) for s in json.load(sys.stdin)]))';
  const r = spawnSync('python', ['-c', script], { input: JSON.stringify(strings), encoding: 'utf8' });
  return JSON.parse(r.stdout);
}

const pairs = fs.readFileSync(PAIRS, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const toks = tokenizeAll(pairs.flatMap((p) => [p.default, p.shaman]));

let sumDef = 0, sumSha = 0;
const perPair = [];
console.log(`\nSHAMAN TALK COMPRESSION  —  ${pairs.length} matched-content pairs (EN+PT)\n`);
console.log('  id                     kind          default   shaman   saved');
for (let i = 0; i < pairs.length; i++) {
  const d = toks[i * 2], s = toks[i * 2 + 1];
  sumDef += d; sumSha += s;
  const saved = (1 - s / d);
  perPair.push({ id: pairs[i].id, kind: pairs[i].kind, def: d, sha: s, saved });
  console.log(`  ${pairs[i].id.padEnd(22)} ${pairs[i].kind.padEnd(12)} ${String(d).padStart(6)}   ${String(s).padStart(6)}   ${(saved * 100).toFixed(0).padStart(3)}%`);
}
const overall = 1 - sumSha / sumDef;
const meanPer = perPair.reduce((a, p) => a + p.saved, 0) / perPair.length;
console.log('  ' + '-'.repeat(62));
console.log(`  ${'TOTAL'.padEnd(22)} ${''.padEnd(12)} ${String(sumDef).padStart(6)}   ${String(sumSha).padStart(6)}   ${(overall * 100).toFixed(0).padStart(3)}%`);
console.log(`\n  output tokens saved, pooled ...... ${(overall * 100).toFixed(1)}%  (${sumDef} -> ${sumSha})`);
console.log(`  output tokens saved, mean/pair ... ${(meanPer * 100).toFixed(1)}%`);
console.log(`  facts/code/numbers preserved ..... by construction (inspect corpus/pairs.jsonl)\n`);

fs.writeFileSync(path.join(here, 'results', 'compress.json'),
  JSON.stringify({ pairs: perPair, pooledSaved: overall, meanSaved: meanPer, sumDef, sumSha }, null, 2));
console.log('wrote bench/results/compress.json\n');
