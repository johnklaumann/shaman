import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { score } = require('../src/lib/score.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The labeled bench corpus doubles as the scoring contract: every corpus
// expectation is asserted here, so a lexicon or threshold change that would
// regress the gate fails the suite before it ships.
const corpus = fs.readFileSync(path.join(root, 'bench', 'corpus', 'prompts.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

test('corpus: every vague prompt scores weak and is never exempt', () => {
  for (const row of corpus.filter((r) => r.cat === 'vague')) {
    const r = score(row.text);
    assert.equal(r.exempt, null, `"${row.text}" must not be exempt`);
    assert.equal(r.band, 'weak', `"${row.text}" must be weak, got ${r.band} (${r.score})`);
  }
});

test('corpus: every strong prompt scores strong, including complex multi-requirement briefs', () => {
  for (const row of corpus.filter((r) => ['strong', 'complex-strong'].includes(r.cat))) {
    const r = score(row.text);
    assert.equal(r.band, 'strong', `"${row.text}" must be strong, got ${r.band} (${r.score})`);
  }
});

test('corpus: verbose-vague prompts are caught — length alone never buys a silent pass', () => {
  for (const row of corpus.filter((r) => r.cat === 'verbose-vague')) {
    const r = score(row.text);
    assert.equal(r.exempt, null, `"${row.text.slice(0, 40)}..." must not be exempt`);
    assert.notEqual(r.band, 'strong', `"${row.text.slice(0, 40)}..." must not be strong (got ${r.score})`);
  }
});

test('corpus: medium prompts score medium (caught but not blockable)', () => {
  for (const row of corpus.filter((r) => r.cat === 'medium')) {
    const r = score(row.text);
    assert.equal(r.exempt, null);
    assert.equal(r.band, 'medium', `"${row.text}" must be medium, got ${r.band} (${r.score})`);
  }
});

test('corpus: acks and conversation are exempt', () => {
  for (const row of corpus.filter((r) => ['ack', 'conv'].includes(r.cat))) {
    const r = score(row.text);
    assert.ok(r.exempt, `"${row.text}" must be exempt, got band ${r.band}`);
  }
});

test('corpus: questions are exempt or flagged isQuestion — never weak-blockable silently', () => {
  for (const row of corpus.filter((r) => r.cat === 'question')) {
    const r = score(row.text);
    assert.ok(r.exempt || r.isQuestion, `"${row.text}" must be exempt or isQuestion`);
  }
});

test('score is monotone as detail is added', () => {
  const s1 = score('fix the login bug').score;
  const s2 = score('fix the login bug in auth.js').score;
  const s3 = score('fix the login bug in auth.js — must return 401 for expired tokens').score;
  assert.ok(s2 > s1, `${s2} > ${s1}`);
  assert.ok(s3 > s2, `${s3} > ${s2}`);
});

test('dimension points sum to the total score', () => {
  const r = score('Refactor parseConfig() in src/config.js, keep the same return shape.');
  const sum = Object.values(r.dims).reduce((a, d) => a + d.pts, 0);
  assert.equal(r.score, sum);
});

test('english decoys do not match short verb stems', () => {
  // 'critical' !~ cri, 'address' !~ add, 'muddy' !~ mud, 'testimony' !~ test, 'migraine' !~ migr
  for (const text of ['the critical path is unclear', 'the address book feature', 'muddy waters here', 'his testimony was long', 'I have a migraine today']) {
    const r = score(text);
    assert.equal(r.dims.action.pts, 0, `"${text}" must not count an action verb`);
  }
});

test('portuguese conjugations count as action verbs', () => {
  for (const text of ['migra o componente Header.jsx pra TypeScript', 'corrige o bug em auth.js', 'adiciona validação no form.js']) {
    assert.equal(score(text).dims.action.pts, 20, `"${text}" must count a verb`);
  }
});

test('plain english slashes are not code targets', () => {
  for (const text of ['we should think about this and/or that maybe', 'support is available 24/7 for everyone here']) {
    assert.equal(score(text).dims.target.pts, 0, `"${text}" must not count a target`);
  }
});
