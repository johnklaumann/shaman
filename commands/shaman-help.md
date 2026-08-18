---
description: Quick reference for shaman commands and modes
---

Show this quick reference, verbatim, then stop:

```
SHAMAN — terse talk, minimal code, scored prompts

/shaman [lite|full|ultra|ab|off]   talk level (default: full)
  lite   drop filler, keep full sentences
  full   drop articles, fragments OK
  ultra  one word when one word enough
  ab     self-measuring A/B: odd days on, even days off, auto-stamped

/shaman-gate [confirm|coach|enrich|off]  prompt gate (default: confirm)
  confirm pause weak prompts (score < 20), preview the context to add, resend to proceed
  coach   block weak prompts before they burn tokens
  enrich  let them pass silently, force assumptions + max 1 clarifying question

/shaman-score <prompt>             score 0-100 + breakdown, without sending
/shaman-bench                      token stats per session, on vs off
/shaman-init                       rule files for Cursor/Copilot/Windsurf/
                                   Cline/Kiro/Qoder/Codex/Gemini
/shaman-help                       this card

Score dimensions: target 30 · action 20 · constraint 20 · context 15 · detail 15
Never gated: slash commands, questions, acks, plain conversation.

Always on: decision ladder (YAGNI > reuse > stdlib > native > installed dep >
one line > minimum build), root-cause fixes, no premature abstraction.
Never sacrificed: validation, error handling, security, accessibility, tests.

Any tool, any model: npx shaman-ai score "..." | npx shaman-ai init
```
