---
description: Quick reference for shaman commands and modes
---

Show this quick reference, verbatim, then stop:

```
SHAMAN — terse talk, minimal code, best practices

/shaman [lite|full|ultra|off]      talk level (default: full)
  lite   drop filler, keep full sentences
  full   drop articles, fragments OK
  ultra  one word when one word enough

/shaman-gate [coach|enrich|off]    prompt gate (default: enrich)
  coach  block vague prompts before they burn tokens, show template
  enrich let them pass, force assumptions + max 1 clarifying question

/shaman-bench                      token stats per session, on vs off
/shaman-init                       generate rules for Cursor / Codex / Copilot
/shaman-help                       this card

Always on: decision ladder (reuse > stdlib > native > dependency > one line
> minimum build), no workarounds, no premature abstraction, YAGNI.
Never sacrificed: validation, error handling, security, accessibility, tests.
```
