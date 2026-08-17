'use strict';
// One canonical ruleset (rules/core.md) -> generated rule files for every tool
// that reads static instructions. Ponytail maintains 16 hand-synced copies and
// a CI script that only *verifies* them; shaman generates, so copies cannot
// drift by construction. Used by scripts/build-adapters.mjs (repo tree, CI
// check) and `shaman init` (user repos).
const fs = require('node:fs');
const path = require('node:path');

const CORE_PATH = path.join(__dirname, '..', '..', 'rules', 'core.md');

// Static-file hosts have no slash commands: retitle, drop the activation
// sentence and the deactivation bullet. Everything else passes through
// verbatim — the ruleset is the product, the wrapper is per-tool ceremony.
function staticBody(core) {
  return core
    .replace(/^# SHAMAN ACTIVE$/m, '# Shaman — terse talk, minimal code')
    .replace(/^Terse talk\. Minimal code\. Scored prompts\. Active every response until `\/shaman off`\.$/m,
      'Terse talk. Minimal code. These rules apply to every response in this repository.')
    .replace(/^- `\/shaman off`.*\r?\n?/m, '')
    .trimEnd() + '\n';
}

const frontmatter = (pairs) => `---\n${pairs.join('\n')}\n---\n\n`;

// path -> wrapper. Paths are relative to a repo root.
const TOOLS = [
  { tool: 'Codex CLI / Gemini CLI / generic agents', file: 'AGENTS.md', wrap: (b) => b },
  {
    tool: 'Cursor', file: '.cursor/rules/shaman.mdc',
    wrap: (b) => frontmatter(['description: Shaman — terse talk, minimal code', 'alwaysApply: true']) + b,
  },
  { tool: 'GitHub Copilot', file: '.github/copilot-instructions.md', wrap: (b) => b },
  { tool: 'Windsurf', file: '.windsurf/rules/shaman.md', wrap: (b) => b },
  { tool: 'Cline', file: '.clinerules/shaman.md', wrap: (b) => b },
  {
    tool: 'Kiro', file: '.kiro/steering/shaman.md',
    wrap: (b) => frontmatter(['inclusion: always']) + b,
  },
  { tool: 'Qoder', file: '.qoder/rules/shaman.md', wrap: (b) => b },
  { tool: 'Roo / generic rules dir', file: '.agents/rules/shaman.md', wrap: (b) => b },
];

function readCore() {
  return fs.readFileSync(CORE_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function render() {
  const body = staticBody(readCore());
  return TOOLS.map(({ tool, file, wrap }) => ({ tool, file, content: wrap(body) }));
}

module.exports = { render, TOOLS, staticBody, readCore };
