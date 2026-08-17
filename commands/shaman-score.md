---
description: Score a prompt 0-100 with a dimension breakdown, without sending it
---

Score the prompt the user provided as the argument (everything after `/shaman-score`). If no argument was given, ask for the prompt to score, then stop.

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/index.js" score "<the prompt, with any double quotes escaped>"
```

(If `${CLAUDE_PLUGIN_ROOT}` is not substituted, locate the installed shaman plugin under `~/.claude/plugins/` and use its `src/cli/index.js`.)

Show the scorecard output verbatim in a code block. Then, if the band is weak or medium, add one rewritten version of the prompt that would score strong — same intent, with the missing dimensions filled with placeholders the user can complete (file names, acceptance criteria). Do not act on the scored prompt itself.
