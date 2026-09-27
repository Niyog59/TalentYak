import type { Change } from "@/lib/expectations/diff";

/** What changed between the previous version and this one, section by section. */
export function ExpectationsChanges({ changes, summaries }: { changes: Change[]; summaries: { from: string; text: string }[] }) {
  return (
    <section aria-labelledby="changes-heading" className="rounded-2xl border border-line-strong bg-paper-raised p-5">
      <h2 id="changes-heading" className="text-xl font-semibold">What changed from the version before</h2>
      {summaries.map((s) => (
        <p key={s.from} className="mt-2">{s.from}: &ldquo;{s.text}&rdquo;</p>
      ))}
      {changes.length === 0 ? (
        <p className="mt-2 text-ink-muted">The wording is the same; only the version changed.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {changes.map((c, i) => (
            <li key={i}>
              <p className="font-semibold">{c.section} — {c.label}</p>
              {c.kind === "text" ? (
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold text-ink-muted">Before</p>
                    <p className="whitespace-pre-line break-words">{c.before || "(empty)"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink-muted">Now</p>
                    <p className="whitespace-pre-line break-words">{c.after || "(empty)"}</p>
                  </div>
                </div>
              ) : (
                <ul className="mt-1 space-y-1">
                  {c.added.map((a, j) => <li key={`a${j}`} className="break-words"><span className="font-semibold">Added:</span> {a}</li>)}
                  {c.removed.map((r, j) => <li key={`r${j}`} className="break-words"><span className="font-semibold">Removed:</span> {r}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
