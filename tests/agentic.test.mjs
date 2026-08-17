import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTIC_CHECKS, fixtureTestsPass } from '../bench/agentic-checks.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(root, 'bench', 'fixtures', 'notes-api');

const TASK_IDS = fs.readFileSync(path.join(root, 'bench', 'corpus', 'agentic-tasks.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l).id);

function cloneFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaman-agtest-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

test('every agentic task has a check and vice versa', () => {
  assert.deepEqual(Object.keys(AGENTIC_CHECKS).sort(), [...TASK_IDS].sort());
});

test('fixture test suite is green at baseline', () => {
  const r = fixtureTestsPass(FIXTURE);
  assert.ok(r.pass, `fixture tests must pass pristine: ${r.out}`);
});

// The core invariant: a check that already passes before the work is done
// measures nothing. Every acceptance check must FAIL on the pristine fixture.
for (const id of TASK_IDS) {
  test(`acceptance check ${id} FAILS on the pristine fixture`, async () => {
    const dir = cloneFixture();
    try {
      const r = await AGENTIC_CHECKS[id](dir);
      assert.equal(r.pass, false, `${id} passed on pristine fixture — it tests nothing`);
      assert.ok(r.reason, `${id} must explain the failure`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    }
  });
}

// And at least one check must be provably satisfiable: apply the reference fix
// for the seeded month bug and the check flips to pass.
test('bugfix-month check passes once the seeded bug is fixed', async () => {
  const dir = cloneFixture();
  try {
    const f = path.join(dir, 'lib', 'format.js');
    const patched = fs.readFileSync(f, 'utf8')
      .replace('String(date.getMonth())', 'String(date.getMonth() + 1)');
    fs.writeFileSync(f, patched);
    const r = await AGENTIC_CHECKS['bugfix-month'](dir);
    assert.ok(r.pass, `reference fix must satisfy the check: ${r.reason}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
