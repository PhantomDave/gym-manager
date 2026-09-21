# CLAUDE.md

The instructions for this repository live in **[AGENTS.md](AGENTS.md)**, which
applies to Claude and to any other agent working here. Read it before touching
anything.

This file exists because Claude Code loads `CLAUDE.md` automatically; keeping
the rules in one place stops the two copies from drifting apart.

The three that cause the most damage when missed:

1. **Verify the artifact, not a surrogate.** `bun run smoke` boots `dist/` in
   WebKitGTK, the engine that ships. A Chromium tab proves only that Chromium is
   happy — that is how a black window reached the desk.
2. **Never push to `main`.** Branch, pull request, review the diff, merge only
   on green.
3. **Say what you did not verify.** That half is usually the one that matters.

The reasoning behind every rule is in [DECISIONS.md](DECISIONS.md).
