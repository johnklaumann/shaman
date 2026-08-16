'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = { mode: 'full', gate: 'enrich' };
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function shamanDir() {
  return path.join(configDir(), 'shaman');
}

function statePath() {
  return path.join(shamanDir(), 'state.json');
}

function benchPath() {
  return path.join(shamanDir(), 'bench.jsonl');
}

// corrupt=true means the file exists but is unreadable — callers should avoid
// persisting the DEFAULTS fallback over it from a background hook.
function loadState() {
  try {
    return { state: { ...DEFAULTS, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }, corrupt: false };
  } catch (err) {
    return { state: { ...DEFAULTS }, corrupt: err.code !== 'ENOENT' };
  }
}

// Atomic: concurrent readers see the old or the new file, never a truncated one.
function writeState(state) {
  fs.mkdirSync(shamanDir(), { recursive: true });
  const tmp = statePath() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, statePath());
}

// sessions: { [sessionId]: { mode, gate, ts } } — the mode a session actually ran
// under ('mixed' after a mid-session switch), so bench snapshots don't inherit
// whatever the global mode happens to be at Stop time.
function pruneSessions(sessions) {
  const out = {};
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of Object.entries(sessions || {})) {
    if (s && s.ts > cutoff) out[id] = s;
  }
  return out;
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

module.exports = { DEFAULTS, configDir, shamanDir, statePath, benchPath, loadState, writeState, pruneSessions, readStdin };
