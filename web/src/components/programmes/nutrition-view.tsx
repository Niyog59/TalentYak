import { quantityText, type NutritionContent } from "@/lib/programmes/content";
import { Paragraphs } from "@/components/programmes/workout-view";

/*
 * Nutrition as the coach wrote it. Every number here is typed by the coach —
 * TalentYak has no food database and calculates nothing — so each one is
 * labelled as the coach's estimate, never presented as measured or verified.
 */

function Estimate() {
  return (
    <span className="ml-1.5 inline-flex rounded-full border border-line-strong px-2 py-0.5 text-xs font-semibold text-ink-muted">
      Coach&rsquo;s estimate
    </span>
  );
}

export function NutritionView({ content, heading = "h3" }: { content: NutritionContent; heading?: "h2" | "h3" }) {
  const H = heading;
  const t = content.targets;
  const hasNumbers = Boolean(
    (t && (t.calories !== null || t.proteinG !== null || t.carbsG !== null || t.fatG !== null)) ||
      content.meals.some((m) => m.items.some((i) => i.estKcal !== null || i.estProteinG !== null)),
  );

  return (
    <div className="space-y-6">
      {content.guidance ? (
        <section>
          <H className="text-lg font-semibold">Guidance</H>
          <Paragraphs text={content.guidance} className="mt-2" />
        </section>
      ) : null}

      {t ? (
        <section>
          <H className="text-lg font-semibold">Daily targets</H>
          <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["Calories", t.calories, "kcal"],
              ["Protein", t.proteinG, "g"],
              ["Carbohydrate", t.carbsG, "g"],
              ["Fat", t.fatG, "g"],
            ] as const)
              .filter(([, v]) => v !== null)
              .map(([label, v, unit]) => (
                <div key={label} className="rounded-xl border border-line bg-surface p-3">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-xl font-semibold">
                    {v} {unit}
                  </dd>
                  <dd><Estimate /></dd>
                </div>
              ))}
          </dl>
          <Paragraphs text={t.note} className="mt-2" />
        </section>
      ) : null}

      {content.meals.length ? (
        <section>
          <H className="text-lg font-semibold">Meal plan</H>
          <ol className="mt-2 space-y-3">
            {content.meals.map((m) => (
              <li key={m.key} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-lg font-semibold">
                  {m.name}
                  {m.time ? <span className="font-normal text-ink-muted"> · {m.time}</span> : null}
                </p>
                {m.items.length ? (
                  <ul className="mt-2 divide-y divide-line">
                    {m.items.map((i) => (
                      <li key={i.key} className="py-2">
                        <p>
                          <span className="font-semibold">{i.food}</span>
                          {quantityText(i) ? <span> — {quantityText(i)}</span> : null}
                        </p>
                        {i.estKcal !== null || i.estProteinG !== null ? (
                          <p className="text-sm text-ink-muted">
                            About {[i.estKcal !== null ? `${i.estKcal} kcal` : "", i.estProteinG !== null ? `${i.estProteinG} g protein` : ""].filter(Boolean).join(", ")}
                            <Estimate />
                          </p>
                        ) : null}
                        {i.substitutions.length ? (
                          <p className="text-sm">
                            <span className="font-semibold">Swap for:</span> {i.substitutions.join(" · ")}
                          </p>
                        ) : null}
                        {i.notes ? <p className="whitespace-pre-line text-sm text-ink-muted">{i.notes}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Paragraphs text={m.notes} className="mt-2 text-ink-muted" />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {content.foodNotes ? (
        <section>
          <H className="text-lg font-semibold">Allergies, preferences and local foods</H>
          <Paragraphs text={content.foodNotes} className="mt-2" />
        </section>
      ) : null}

      <p className="rounded-lg border border-line-strong bg-paper-raised p-3 text-sm">
        {hasNumbers ? <>Numbers marked &ldquo;Coach&rsquo;s estimate&rdquo; were entered by your coach. TalentYak doesn&rsquo;t measure or verify nutrition values. </> : null}
        This is general guidance from your coach, not medical or clinical nutrition advice.
      </p>
    </div>
  );
}
