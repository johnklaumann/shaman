import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { render } = require('../src/lib/adapters.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('committed adapters/ tree matches the generator output exactly', () => {
  for (const { file, content } of render()) {
    const committed = fs.readFileSync(path.join(root, 'adapters', file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(committed, content, `adapters/${file} drifted — run: node scripts/build-adapters.mjs`);
  }
});

test('static adapters carry the ladder but no slash-command references', () => {
  for (const { file, content } of render()) {
    assert.match(content, /decision ladder/i, `${file} must contain the ladder`);
    assert.doesNotMatch(content, /\/shaman off/, `${file} must not reference slash commands`);
  }
});

test('cursor adapter has alwaysApply frontmatter; kiro has inclusion always', () => {
  const byFile = Object.fromEntries(render().map((a) => [a.file, a.content]));
  assert.match(byFile['.cursor/rules/shaman.mdc'], /^---\n[\s\S]*alwaysApply: true[\s\S]*?---/);
  assert.match(byFile['.kiro/steering/shaman.md'], /^---\ninclusion: always\n---/);
});
