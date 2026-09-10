# Agent entry point

Read `CLAUDE.md` in full before doing anything. It is the contract for this project — invariants, security operating rules, money discipline, design and tone rules, and session protocols.

Then read, in this order:

1. `docs/aafnai/DECISION_REGISTER.md` — **the current product authority.** Every rule with a status: confirmed, proposed, open, or superseded. Where this and any other document disagree, **this one wins**.
2. `docs/aafnai/PRODUCT_CONTRACT.md` — what the product must do.
3. `ARCHITECTURE.md` — what exists, and the node registry of what is deliberately reserved.
4. `docs/aafnai/CODEBASE_RECONCILIATION.md` — each requirement mapped to real code.
5. The relevant spec in `docs/specs/`.

`docs/HANDOVER.md` is business context and history. It was amended on 2026-09-09 and §6 was replaced; read it for background, not for current rules.

Two rules that catch people out:

1. **Plan first, always.** Present a plan or spec and stop for approval before writing code. No exceptions for "small" changes.
2. **Stop before touching money, grief data, or health data** unless the prompt explicitly authorizes it. See `CLAUDE.md` → Interruption & failure protocol.
