# Verification scripts

These are adversarial-replay scripts for features whose full behaviour
cannot be captured by unit tests alone — typically because they involve
platform-specific codepaths, interactive UI, or the Electron runtime.

Each script is written so a human or an AI agent can follow it step by
step, record what they observed, and compare against the "expected"
column. The goal is to make "I verified this works" a repeatable,
evidence-backed claim rather than a vibe.

## How to use these scripts

1. Find the script matching the feature you changed or are verifying.
2. Read the **Preconditions** block and bring the machine into that
   state (delete files, install or uninstall tools, etc.).
3. Walk each numbered step. For every step:
   - Do the action.
   - Record what you observed in a scratch file.
   - Compare against **Expected**.
4. At the bottom of the script, record the overall pass/fail and any
   follow-up bugs you filed.

If a step is impossible to run on your host (for example, you are on
macOS and the script is Windows-only), mark it explicitly as
`[SKIPPED: wrong host OS]` rather than silently glossing over it. That
keeps the replay record honest about what was and wasn't tested.

## Scripts in this directory

- [`shell-selection.md`](./shell-selection.md) — shell registry,
  preferences persistence, workspace overrides, first-run prompt,
  WSL spawn path.

## When to write a new script

Add one whenever you land a feature whose correctness depends on:

- a platform-specific branch (Windows-only, macOS-only, WSL, etc.);
- persisted state that survives restarts;
- an interactive UI flow with multiple screens or modals;
- an external process you spawn or a wire protocol you speak.

Keep scripts short, concrete, and written in imperative mood. The
payoff is that the next person — human or agent — does not have to
rediscover how to exercise the feature.
