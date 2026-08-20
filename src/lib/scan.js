'use strict';
// Security/quality scanner for agent-written code — pure functions, no I/O.
// Deliberately HIGH-SIGNAL and small: our own corpus validation (649
// agent-authored files via Bandit) showed generic scanners are ~94% noise on
// real agent code (asserts, test fixtures); the genuine classes were
// interpolated SQL plus the classic agent slips (hardcoded secrets, eval,
// shell=True, unsafe deserialization). These rules target exactly that band.
//
// severity: 'high' → worth stopping a "done" claim over. 'med' → logged, never
// blocks (too context-dependent to block on: innerHTML, yaml.load, new Function).
// Findings in test files are marked test:true — fixture creds are how tests are
// written; never a block.

const PY = ['.py'];
const JS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'];
const ANY = null;

// [id, severity, extensions, lineRegex, message]
const RULES = [
  ['secret-literal', 'high', ANY,
    /(?:api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"'$\s]{8,}["']/i,
    'hardcoded credential-looking literal'],
  ['aws-key', 'high', ANY, /\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  ['private-key', 'high', ANY, /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/, 'private key material'],
  ['sql-interp-py', 'high', PY, /f["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^"']*\{/i,
    'SQL built with f-string interpolation — parameterize instead'],
  ['sql-interp-js', 'high', JS, /`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{/i,
    'SQL built with template interpolation — parameterize instead'],
  ['eval-dynamic', 'high', [...PY, ...JS], /\beval\s*\(\s*[^"'`)\s]/, 'eval of a non-literal expression'],
  ['shell-true-py', 'high', PY, /\bshell\s*=\s*True\b/, 'subprocess with shell=True'],
  ['shell-true-js', 'high', JS, /\bshell\s*:\s*true\b/, 'child_process with shell:true'],
  ['os-system', 'high', PY, /\bos\.system\s*\(\s*[^"')]/, 'os.system with a non-literal command'],
  ['pickle-load', 'high', PY, /\bpickle\.loads?\s*\(/, 'pickle deserialization (unsafe on untrusted data)'],
  ['new-function', 'med', JS, /\bnew\s+Function\s*\(/, 'dynamic Function constructor'],
  ['yaml-load', 'med', PY, /\byaml\.load\s*\((?![^)]*Loader)/, 'yaml.load without an explicit safe Loader'],
  ['inner-html', 'med', JS, /\.innerHTML\s*=\s*[^"'`]/, 'innerHTML assigned a non-literal — XSS sink'],
];

const isTestPath = (p) =>
  /(^|[\\/])(tests?|__tests__|specs?|fixtures?|mocks?|e2e)([\\/]|$)|\.(test|spec)\.[a-z]+$/i.test(p);

function scanContent(file, content) {
  const ext = (file.match(/\.[a-z]+$/i) || [''])[0].toLowerCase();
  const test = isTestPath(file);
  const findings = [];
  const lines = content.split('\n');
  for (const [id, sev, exts, re, msg] of RULES) {
    if (exts && !exts.includes(ext)) continue;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) findings.push({ file, line: i + 1, id, sev, msg, test });
    }
  }
  return findings;
}

module.exports = { scanContent, isTestPath, RULES };
