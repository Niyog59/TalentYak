"use client";

import { useState } from "react";
import {
  FOOD_UNITS,
  FOOD_UNIT_LABEL,
  LIMITS,
  type FoodItem,
  type Meal,
  type NutritionContent,
  type Targets,
} from "@/lib/programmes/content";
import { AddButton, Choice, ItemTools, LongText, NumberInput, TextInput, move, newKey } from "@/components/programmes/editor-fields";

/*
 * The coach's nutrition editor. Three ways to guide eating — written guidance,
 * daily targets, a structured meal plan — and a coach uses any of them, one or
 * all. Every number is the coach's own estimate: nothing is looked up or
 * calculated, and the client sees each one labelled that way.
 */

const EMPTY_TARGETS: Targets = { calories: null, proteinG: null, carbsG: null, fatG: null, note: "" };

function blankItem(): FoodItem {
  return { key: newKey(), food: "", quantity: null, unit: "", prepared: "", substitutions: [], notes: "", estKcal: null, estProteinG: null };
}

function ItemEditor({ i, index, count, onChange, onMove, onRemove }: {
  i: FoodItem;
  index: number;
  count: number;
  onChange: (i: FoodItem) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof FoodItem>(k: K, v: FoodItem[K]) => onChange({ ...i, [k]: v });
  // Swaps are edited one per line and kept as a list.
  const [swaps, setSwaps] = useState(i.substitutions.join("\n"));
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Food" value={i.food} onChange={(v) => set("food", v)} maxLength={LIMITS.food} required placeholder="e.g. Rice, dal, chicken curry" className="sm:col-span-2" />
        <NumberInput label="Amount" value={i.quantity} onChange={(v) => set("quantity", v)} min={0.01} max={10000} step={0.25} />
        <Choice label="Unit" value={i.unit} onChange={(v) => set("unit", v)} options={[{ value: "", label: "—" }, ...FOOD_UNITS.map((u) => ({ value: u, label: FOOD_UNIT_LABEL[u] }))]} />
        <Choice
          label="Weighed or measured"
          value={i.prepared}
          onChange={(v) => set("prepared", v)}
          options={[{ value: "", label: "Not specified" }, { value: "cooked", label: "Cooked" }, { value: "raw", label: "Raw / uncooked" }]}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Calories" suffix="estimate" value={i.estKcal} onChange={(v) => set("estKcal", v)} min={0} max={5000} />
          <NumberInput label="Protein" suffix="g, estimate" value={i.estProteinG} onChange={(v) => set("estProteinG", v)} min={0} max={500} step={0.5} />
        </div>
        <LongText
          label="Swaps"
          value={swaps}
          onChange={(v) => {
            setSwaps(v);
            set("substitutions", v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMITS.substitutions));
          }}
          rows={2}
          help={`One per line, up to ${LIMITS.substitutions}. e.g. "2 rotis instead of rice".`}
        />
        <LongText label="Notes" value={i.notes} onChange={(v) => set("notes", v)} maxLength={LIMITS.itemNote} rows={2} />
      </div>
      <div className="mt-3">
        <ItemTools name={i.food || `food ${index + 1}`} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
    </li>
  );
}

function MealEditor({ m, index, count, onChange, onMove, onRemove }: {
  m: Meal;
  index: number;
  count: number;
  onChange: (m: Meal) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-2xl border border-line-strong bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Meal" value={m.name} onChange={(v) => onChange({ ...m, name: v })} maxLength={LIMITS.mealName} required placeholder="e.g. Breakfast" />
        <TextInput label="When" value={m.time} onChange={(v) => onChange({ ...m, time: v })} maxLength={LIMITS.mealTime} placeholder="e.g. Before work" />
      </div>
      <h4 className="mt-4 font-semibold">Foods</h4>
      <ol className="mt-2 space-y-2">
        {m.items.map((it, i) => (
          <ItemEditor
            key={it.key}
            i={it}
            index={i}
            count={m.items.length}
            onChange={(next) => onChange({ ...m, items: m.items.map((x, j) => (j === i ? next : x)) })}
            onMove={(to) => onChange({ ...m, items: move(m.items, i, to) })}
            onRemove={() => onChange({ ...m, items: m.items.filter((_, j) => j !== i) })}
          />
        ))}
      </ol>
      {m.items.length < LIMITS.items ? (
        <div className="mt-3"><AddButton onClick={() => onChange({ ...m, items: [...m.items, blankItem()] })}>Add a food</AddButton></div>
      ) : null}
      <LongText label="Meal notes" value={m.notes} onChange={(v) => onChange({ ...m, notes: v })} maxLength={LIMITS.notes} rows={2} className="mt-3" />
      <div className="mt-4 border-t border-line pt-3">
        <ItemTools name={m.name || `meal ${index + 1}`} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
    </li>
  );
}

export function NutritionEditor({ initial }: { initial: NutritionContent }) {
  const [c, setC] = useState<NutritionContent>(initial);
  const t = c.targets ?? EMPTY_TARGETS;
  const setT = <K extends keyof Targets>(k: K, v: Targets[K]) => setC({ ...c, targets: { ...t, [k]: v } });

  return (
    <div className="space-y-6">
      <input type="hidden" name="content" value={JSON.stringify(c)} />
      <p className="rounded-lg border border-line-strong bg-paper-raised p-3">
        Use any of the three parts below — one is enough. Numbers you enter are shown to your client as <strong>your estimates</strong>; TalentYak doesn&rsquo;t look them up or check them. Keep to general guidance: no medical or clinical diets.
      </p>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 text-lg font-semibold">1 · Written guidance</legend>
        <LongText label="Guidance" value={c.guidance} onChange={(v) => setC({ ...c, guidance: v })} maxLength={LIMITS.guidance} rows={6} help="Habits, portions, timing — in your own words." />
      </fieldset>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 text-lg font-semibold">2 · Daily targets</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberInput label="Calories" suffix="kcal" value={t.calories} onChange={(v) => setT("calories", v)} min={500} max={10000} step={10} />
          <NumberInput label="Protein" suffix="g" value={t.proteinG} onChange={(v) => setT("proteinG", v)} min={0} max={1000} />
          <NumberInput label="Carbohydrate" suffix="g" value={t.carbsG} onChange={(v) => setT("carbsG", v)} min={0} max={2000} />
          <NumberInput label="Fat" suffix="g" value={t.fatG} onChange={(v) => setT("fatG", v)} min={0} max={1000} />
        </div>
        <LongText label="About these targets" value={t.note} onChange={(v) => setT("note", v)} maxLength={LIMITS.targetNote} rows={2} className="mt-3" help="e.g. A starting point; we'll adjust after two weeks." />
      </fieldset>

      <fieldset className="rounded-2xl border border-line p-4">
        <legend className="px-1 text-lg font-semibold">3 · Meal plan</legend>
        {c.meals.length ? (
          <ol className="space-y-3">
            {c.meals.map((m, i) => (
              <MealEditor
                key={m.key}
                m={m}
                index={i}
                count={c.meals.length}
                onChange={(next) => setC({ ...c, meals: c.meals.map((x, j) => (j === i ? next : x)) })}
                onMove={(to) => setC({ ...c, meals: move(c.meals, i, to) })}
                onRemove={() => setC({ ...c, meals: c.meals.filter((_, j) => j !== i) })}
              />
            ))}
          </ol>
        ) : (
          <p className="text-ink-muted">No meals yet.</p>
        )}
        {c.meals.length < LIMITS.meals ? (
          <div className="mt-3">
            <AddButton onClick={() => setC({ ...c, meals: [...c.meals, { key: newKey(), name: "", time: "", notes: "", items: [blankItem()] }] })}>Add a meal</AddButton>
          </div>
        ) : null}
      </fieldset>

      <LongText
        label="Allergies, preferences and local foods"
        value={c.foodNotes}
        onChange={(v) => setC({ ...c, foodNotes: v })}
        maxLength={LIMITS.foodNotes}
        rows={3}
        help="How this plan fits your client — foods to avoid, what they like, what's affordable and easy to find where they live."
      />
    </div>
  );
}
