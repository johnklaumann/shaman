// Acceptance checks for the agentic benchmark. Each receives the fixture dir a
// session just modified and returns { pass, reason }. They probe the running
// HTTP server (black-box, like a real acceptance test) or the module files —
// never the diff — so any correct implementation passes regardless of style.
//
// Self-test invariant (tests/agentic.test.mjs): every check FAILS on the
// pristine fixture. A check that passes before the work is done measures
// nothing.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Start server.js on an ephemeral port, wait for the listening line, hand the
// base URL to fn, always kill the child.
async function withServer(dir, fn) {
  const port = 3100 + Math.floor(Math.random() * 800);
  const child = spawn('node', ['server.js'], {
    cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start in 8s')), 8000);
      child.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
      child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
    });
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // TerminateProcess is async on Windows: wait for the exit event before the
    // caller's rmSync, or the dying child still holds the workspace dir.
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const t = setTimeout(resolve, 3000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      child.kill('SIGKILL');
    });
  }
}

const jfetch = async (url, opts) => {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

const post = (base, payload) => jfetch(`${base}/notes`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

export const AGENTIC_CHECKS = {
  // The seeded bug is getMonth() without +1. Black-box via the API: a note
  // created now must show the CURRENT month in createdAt (DD/MM/YYYY).
  'bugfix-month': (dir) => withServer(dir, async (base) => {
    await post(base, { title: 'month check' });
    const { body } = await jfetch(`${base}/notes`);
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const created = body?.[0]?.createdAt || '';
    if (created.split('/')[1] === mm) return { pass: true, reason: '' };
    return { pass: false, reason: `createdAt "${created}" does not show current month ${mm}` };
  }),

  'feat-delete': (dir) => withServer(dir, async (base) => {
    const { body: note } = await post(base, { title: 'to delete' });
    const del = await fetch(`${base}/notes/${note.id}`, { method: 'DELETE' });
    if (del.status !== 204) return { pass: false, reason: `DELETE existing -> ${del.status}, want 204` };
    const list = await jfetch(`${base}/notes`);
    if (list.body.some((n) => n.id === note.id)) return { pass: false, reason: 'note still listed after delete' };
    const missing = await fetch(`${base}/notes/99999`, { method: 'DELETE' });
    if (missing.status !== 404) return { pass: false, reason: `DELETE unknown -> ${missing.status}, want 404` };
    return { pass: true, reason: '' };
  }),

  'feat-search': (dir) => withServer(dir, async (base) => {
    await post(base, { title: 'Groceries list' });
    await post(base, { title: 'Meeting notes' });
    const hit = await jfetch(`${base}/notes?q=grocer`);
    if (!Array.isArray(hit.body) || hit.body.length !== 1 || !/groceries/i.test(hit.body[0].title)) {
      return { pass: false, reason: `?q=grocer returned ${JSON.stringify(hit.body)?.slice(0, 80)}` };
    }
    const all = await jfetch(`${base}/notes`);
    if (all.body.length !== 2) return { pass: false, reason: 'no q must return everything' };
    return { pass: true, reason: '' };
  }),

  'valid-limits': (dir) => withServer(dir, async (base) => {
    const long = await post(base, { title: 'x'.repeat(101) });
    if (long.status !== 400 || !long.body?.error) return { pass: false, reason: `101-char title -> ${long.status}, want 400 + error` };
    const ok = await post(base, { title: 'x'.repeat(100) });
    if (ok.status !== 201) return { pass: false, reason: `100-char title -> ${ok.status}, want 201` };
    return { pass: true, reason: '' };
  }),

  'feat-stats': (dir) => withServer(dir, async (base) => {
    await post(base, { title: 'one' });
    await post(base, { title: 'two' });
    const { status, body } = await jfetch(`${base}/notes/stats`);
    if (status !== 200 || body?.total !== 2) return { pass: false, reason: `/notes/stats -> ${status} ${JSON.stringify(body)}, want {total:2}` };
    return { pass: true, reason: '' };
  }),

  // White-box by necessity: exactly one isNonEmptyString definition across lib/,
  // both modules still export working behavior (their tests cover it).
  'refactor-dedup': async (dir) => {
    const libDir = path.join(dir, 'lib');
    const defs = fs.readdirSync(libDir)
      .filter((f) => f.endsWith('.js'))
      .flatMap((f) => {
        const src = fs.readFileSync(path.join(libDir, f), 'utf8');
        return [...src.matchAll(/(?:function\s+isNonEmptyString|const\s+isNonEmptyString\s*=)/g)].map(() => f);
      });
    if (defs.length !== 1) return { pass: false, reason: `${defs.length} isNonEmptyString definitions in lib/ (${defs.join(', ') || 'none'}), want exactly 1` };
    return { pass: true, reason: '' };
  },
};

// Fixture test suite must also stay green after every session.
export function fixtureTestsPass(dir) {
  const r = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60000, shell: true });
  return { pass: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).slice(-400) };
}
