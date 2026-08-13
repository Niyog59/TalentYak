# Agent entry point

Read `CLAUDE.md` in full before doing anything. It is the contract for this project — invariants, security operating rules, money discipline, design and tone rules, and session protocols.

Then read `docs/STATE.md` (what actually exists), `docs/DIRECTION.md` (where we're going and what has been rejected), and the relevant spec in `docs/specs/`.

Two rules that catch people out:

1. **Plan first, always.** Present a plan or spec and stop for approval before writing code. No exceptions for "small" changes.
2. **Stop before touching money, grief data, or health data** unless the prompt explicitly authorizes it. See `CLAUDE.md` → Interruption & failure protocol.
