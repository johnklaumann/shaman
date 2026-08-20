#!/usr/bin/env node
// Token autopsy — where do a user's real session tokens actually go?
//
//   node bench/autopsy.mjs [days=30]
//
// Streams every ~/.claude/projects/*/*.jsonl modified in the window and
// decomposes spend so product decisions target the biggest slice, not a guess.
// This is the tool that reframed shaman: it showed cost is ~86% context
// (cacheRead+cacheWrite), output only ~13%, of which prose is a fifth — so the
// talk-compression win (~47% on prose) is ~1% of total, while exploration
// (Read ~57% of context ingest, median ~19 tool calls before the first edit) is
// the real lever. Findings feed the convergence fields the Stop hook now records
// (src/hooks/bench.js) — this measures the whole population, that tracks it live.
//
// Estimates only: char/4 token proxy for block sizing; API-reported usage for
// the cost split (deduped by message id, since usage repeats across block
// entries). Transcript format is internal to Claude Code and may change.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const DAYS = Number(process.argv[2] || 30);
const cutoff = Date.now() - DAYS * 86400e3;
const tk = (s) => Math.round((s || '').length / 4); // char/4 token proxy

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EXPLORE = new Set(['Read', 'Grep', 'Glob', 'LS']);

const agg = {
  files: 0, reqs: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  out: { thinking: 0, text: 0, toolEdit: 0, toolOther: 0, sidechainAll: 0 },
  ctx: {}, userText: 0,
  conv: [], turns: [],
  perFile: [],
};

async function one(fp, proj) {
  const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
  const toolName = new Map();
  const seenUsage = new Set();
  const f = { proj, file: path.basename(fp), input: 0, output: 0, cacheRead: 0, cacheCreate: 0, reqs: 0 };
  let before = 0, explBefore = 0, sawEdit = false, userMsgs = 0, asstMsgs = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message;
    if (!m) continue;
    const side = j.isSidechain === true;
    if (j.type === 'assistant') {
      if (!side) asstMsgs++;
      const u = m.usage;
      if (u && m.id && !seenUsage.has(m.id)) {
        seenUsage.add(m.id);
        f.reqs++; agg.reqs++;
        f.input += u.input_tokens || 0; f.output += u.output_tokens || 0;
        f.cacheRead += u.cache_read_input_tokens || 0; f.cacheCreate += u.cache_creation_input_tokens || 0;
      }
      const content = Array.isArray(m.content) ? m.content : [];
      for (const b of content) {
        let sz = 0, slot = null;
        if (b.type === 'thinking') { sz = tk(b.thinking); slot = 'thinking'; }
        else if (b.type === 'text') { sz = tk(b.text); slot = 'text'; }
        else if (b.type === 'tool_use') {
          toolName.set(b.id, b.name);
          sz = tk(JSON.stringify(b.input || {}));
          slot = EDIT.has(b.name) ? 'toolEdit' : 'toolOther';
          if (!side && !sawEdit) {
            if (EDIT.has(b.name)) sawEdit = true;
            else { before++; if (EXPLORE.has(b.name)) explBefore++; }
          }
        }
        if (slot) { agg.out[slot] += sz; if (side) agg.out.sidechainAll += sz; }
      }
    } else if (j.type === 'user') {
      const content = Array.isArray(m.content) ? m.content
        : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []);
      let toolRes = false;
      for (const b of content) {
        if (b.type === 'tool_result') {
          toolRes = true;
          let sz = 0;
          if (typeof b.content === 'string') sz = tk(b.content);
          else if (Array.isArray(b.content)) for (const c of b.content) sz += tk(c.text);
          let name = toolName.get(b.tool_use_id) || 'unknown';
          if (name.startsWith('mcp__')) name = 'MCP';
          agg.ctx[name] = (agg.ctx[name] || 0) + sz;
        } else if (b.type === 'text' && !side) agg.userText += tk(b.text);
      }
      if (!toolRes && !side) userMsgs++;
    }
  }
  agg.usage.input += f.input; agg.usage.output += f.output;
  agg.usage.cacheRead += f.cacheRead; agg.usage.cacheCreate += f.cacheCreate;
  if (sawEdit) agg.conv.push({ before, explBefore });
  if (userMsgs > 2) agg.turns.push(asstMsgs / userMsgs);
  agg.perFile.push(f);
  agg.files++;
}

const files = [];
for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory() || /shaman-agentic/.test(d.name)) continue;
  const dir = path.join(ROOT, d.name);
  for (const fn of fs.readdirSync(dir)) {
    if (!fn.endsWith('.jsonl')) continue;
    const fp = path.join(dir, fn);
    if (fs.statSync(fp).mtimeMs >= cutoff) files.push([fp, d.name]);
  }
}
for (const [fp, proj] of files) await one(fp, proj);

const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-');
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k');
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.9)] : 0; };

console.log(`TOKEN AUTOPSY — ${agg.files} transcript files, last ${DAYS}d, ${agg.reqs} API requests\n`);

const u = agg.usage;
const cost = u.input * 1 + u.output * 5 + u.cacheRead * 0.1 + u.cacheCreate * 1.25;
console.log('1) REAL USAGE (API-reported, deduped)');
console.log(`   input ${k(u.input)} | output ${k(u.output)} | cacheRead ${k(u.cacheRead)} | cacheWrite ${k(u.cacheCreate)}`);
console.log('   cost-weighted (in=1x, out=5x, cacheR=0.1x, cacheW=1.25x):');
console.log(`   output ${pct(u.output * 5, cost)} | cacheWrite ${pct(u.cacheCreate * 1.25, cost)} | cacheRead ${pct(u.cacheRead * 0.1, cost)} | input ${pct(u.input, cost)}\n`);

const o = agg.out; const oTot = o.thinking + o.text + o.toolEdit + o.toolOther;
console.log('2) OUTPUT DECOMPOSITION (char/4 proxy over content blocks)');
console.log(`   thinking ${pct(o.thinking, oTot)} | prose text ${pct(o.text, oTot)} | edit-tool args ${pct(o.toolEdit, oTot)} | other-tool args ${pct(o.toolOther, oTot)}`);
console.log(`   (sidechain/subagent share of all output blocks: ${pct(o.sidechainAll, oTot)})\n`);

const ctxTot = Object.values(agg.ctx).reduce((a, b) => a + b, 0);
console.log('3) CONTEXT INGEST — tool_result size by tool (what fills cacheWrite)');
const rows = Object.entries(agg.ctx).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [name, sz] of rows) console.log(`   ${name.padEnd(14)} ${k(sz).padStart(8)}  ${pct(sz, ctxTot)}`);
const expl = (agg.ctx.Read || 0) + (agg.ctx.Grep || 0) + (agg.ctx.Glob || 0) + (agg.ctx.LS || 0);
console.log(`   exploration (Read+Grep+Glob+LS) = ${pct(expl, ctxTot)} of all tool results; user text ${k(agg.userText)}\n`);

console.log('4) CONVERGENCE — main-chain tool calls before first Edit/Write');
console.log(`   sessions with edits: ${agg.conv.length}`);
console.log(`   median ${med(agg.conv.map((c) => c.before))} calls (p90 ${p90(agg.conv.map((c) => c.before))}), of which exploration median ${med(agg.conv.map((c) => c.explBefore))} (p90 ${p90(agg.conv.map((c) => c.explBefore))})\n`);

console.log(`5) TURNS — assistant msgs per user turn: median ${med(agg.turns).toFixed(1)}, p90 ${p90(agg.turns).toFixed(1)} (n=${agg.turns.length} sessions)\n`);

console.log('6) TOP 5 BURNER SESSIONS (by cost-weight)');
for (const f of agg.perFile
  .map((f) => ({ ...f, w: f.input + f.output * 5 + f.cacheRead * 0.1 + f.cacheCreate * 1.25 }))
  .sort((a, b) => b.w - a.w).slice(0, 5))
  console.log(`   ${f.proj.slice(0, 40).padEnd(42)} out ${k(f.output).padStart(7)}  cacheW ${k(f.cacheCreate).padStart(7)}  reqs ${f.reqs}`);
