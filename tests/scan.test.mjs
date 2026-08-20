import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = await import(`file://${path.join(root, 'src', 'lib', 'scan.js').replace(/\\/g, '/')}`);
const { scanContent, isTestPath } = pkg.default;

const has = (fs, id) => fs.some((f) => f.id === id);

test('flags a hardcoded credential in a non-test file as high severity', () => {
  const f = scanContent('src/api.js', 'const password = "hunter2super";\n');
  assert.ok(has(f, 'secret-literal'));
  assert.equal(f[0].sev, 'high');
  assert.equal(f[0].test, false);
  assert.equal(f[0].line, 1);
});

test('marks findings in test files as test:true (fixtures are not a block)', () => {
  const f = scanContent('tests/api.test.js', 'const apiKey = "abcdef123456";\n');
  assert.ok(f.length);
  assert.ok(f.every((x) => x.test === true));
});

test('detects f-string SQL (python) and template SQL (js)', () => {
  assert.ok(has(scanContent('db.py', 'q = f"SELECT * FROM t WHERE id={uid}"\n'), 'sql-interp-py'));
  assert.ok(has(scanContent('db.ts', 'const q = `SELECT * FROM t WHERE id=${uid}`;\n'), 'sql-interp-js'));
});

test('detects eval of a non-literal and shell=True', () => {
  assert.ok(has(scanContent('a.js', 'eval(userInput)\n'), 'eval-dynamic'));
  assert.ok(has(scanContent('a.py', 'subprocess.run(cmd, shell=True)\n'), 'shell-true-py'));
});

test('innerHTML is med severity, not high (context-dependent, never blocks)', () => {
  const f = scanContent('ui.tsx', 'el.innerHTML = userHtml;\n');
  assert.ok(has(f, 'inner-html'));
  assert.equal(f.find((x) => x.id === 'inner-html').sev, 'med');
});

test('clean code produces no findings; literal assignments are not secrets', () => {
  assert.equal(scanContent('a.py', 'x = 1\ndef f():\n    return x + 1\n').length, 0);
  assert.equal(scanContent('a.js', 'const password = getFromEnv();\n').length, 0, 'non-literal value is fine');
});

test('isTestPath recognizes common test layouts', () => {
  assert.ok(isTestPath('tests/x.py'));
  assert.ok(isTestPath('src/foo.test.ts'));
  assert.ok(isTestPath('a/__tests__/b.js'));
  assert.ok(!isTestPath('src/api.js'));
});
