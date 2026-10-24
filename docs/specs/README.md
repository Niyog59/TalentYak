# Specs

One file per module: `module-N.md`. The detailed feature specification each module was built from, saved by the build prompt **before** implementation begins.

These are the source of truth for what each screen does and what "done" means for that module. A module is not complete because the code runs — it is complete when it is verified against the acceptance criteria written here.

A spec should contain:

- **Goal** — one paragraph, in product terms
- **Scope** — what is in, and explicitly what is out
- **Data** — tables touched or created, and their RLS policies
- **Personal data** — any new class, place, or reader → must also update `docs/DATA-MAP.md`
- **Acceptance criteria** — testable statements, not aspirations
- **Out of scope / deferred** — goes to `TASKS.md` with a trigger
