---
name: False block / wrong score
about: The gate blocked a legitimate prompt, or scored one absurdly
labels: gate-accuracy
---

**The prompt** (verbatim — this becomes a corpus entry):

```
```

**Language:** en / pt / other

**What the gate did:** blocked / enriched / passed

**What it should have done:** blocked / enriched / passed

**Scorecard** — paste the output of `npx shaman-ai score "..."`:

```
```

Every confirmed false block becomes a labeled prompt in `bench/corpus/prompts.jsonl`, so CI guarantees it never regresses. That corpus is the gate's contract — thank you.
