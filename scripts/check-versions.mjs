#!/usr/bin/env node
// Version-sync gate: package.json, .claude-plugin/plugin.json and
// .codex-plugin/plugin.json must agree before a release tag goes out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const versions = {
  'package.json': read('package.json').version,
  '.claude-plugin/plugin.json': read('.claude-plugin/plugin.json').version,
  '.codex-plugin/plugin.json': read('.codex-plugin/plugin.json').version,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  console.error('VERSION MISMATCH:');
  for (const [f, v] of Object.entries(versions)) console.error(`  ${f}: ${v}`);
  process.exit(1);
}
console.log(`versions in sync: ${[...unique][0]}`);
