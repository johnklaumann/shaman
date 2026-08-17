#!/usr/bin/env node
// Regenerate adapters/ from rules/core.md. `--check` verifies the committed
// tree matches what the generator produces (CI gate: adapters can never drift
// from the canonical ruleset).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { render } = require('../src/lib/adapters.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'adapters');
const check = process.argv.includes('--check');

let drift = 0;
for (const { file, content } of render()) {
  const dest = path.join(outDir, file);
  if (check) {
    let existing = null;
    try { existing = fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n'); } catch {}
    if (existing !== content) {
      console.error(`DRIFT: adapters/${file} does not match rules/core.md — run: node scripts/build-adapters.mjs`);
      drift++;
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log(`wrote adapters/${file}`);
  }
}

if (check) {
  if (drift) process.exit(1);
  console.log('adapters/ in sync with rules/core.md');
}
