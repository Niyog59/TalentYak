import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/button";

const inputClass =
  "rounded-[3px] border border-line bg-white/60 px-3 py-2 font-sans text-sm";

/** 7-day rolling average of the most recent week of weigh-ins. */
function sevenDayAverage(logs: { logged_on: string; weight_kg: number }[]) {
  const recent = [...logs]
    .sort((a, b) => b.logged_on.localeCompare(a.logged_on))
    .slice(0, 7);
  if (recent.length === 0) return null;
  const sum = recent.reduce((acc, l) => acc + Number(l.weight_kg), 0);
  return (sum / recent.length).toFixed(1);
}

export default async function CoachClientPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createClient();
  if (!supabase) return null;

  // RLS: only visible if this booking is assigned to the signed-in coach.
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_name, customer_email, intake_response, services(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) notFound();

  const { data: programs } = await supabase
    .from("programs")
    .select("id, title, goal, notes, active, program_days(id, day_index, title, exercises(id, name, sets, reps, sort))")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false });

  const { data: weights } = await supabase
    .from("bodyweight_logs")
    .select("logged_on, weight_kg")
    .eq("booking_id", bookingId)
    .order("logged_on", { ascending: false })
    .limit(30);

  const intake = (booking.intake_response ?? {}) as Record<string, unknown>;
  const avg = sevenDayAverage(weights ?? []);

  async function createProgram(formData: FormData) {
    "use server";
    const supabase = await createClient();
    if (!supabase) return;
    await supabase.from("programs").insert({
      booking_id: bookingId,
      title: String(formData.get("title") || "Program"),
      goal: String(formData.get("goal") || "") || null,
      notes: String(formData.get("notes") || "") || null,
    });
    revalidatePath(`/coach/clients/${bookingId}`);
  }

  async function addDay(formData: FormData) {
    "use server";
    const supabase = await createClient();
    if (!supabase) return;
    await supabase.from("program_days").insert({
      program_id: String(formData.get("program_id")),
      day_index: Number(formData.get("day_index") || 1),
      title: String(formData.get("title") || "Day"),
    });
    revalidatePath(`/coach/clients/${bookingId}`);
  }

  async function addExercise(formData: FormData) {
    "use server";
    const supabase = await createClient();
    if (!supabase) return;
    await supabase.from("exercises").insert({
      program_day_id: String(formData.get("program_day_id")),
      name: String(formData.get("name") || "").trim(),
      sets: Number(formData.get("sets") || 3),
      reps: String(formData.get("reps") || "8-12"),
    });
    revalidatePath(`/coach/clients/${bookingId}`);
  }

  const service = Array.isArray(booking.services)
    ? booking.services[0]
    : booking.services;

  return (
    <div>
      <p className="label text-ink/50">
        <Link href="/coach" className="hover:text-terracotta">← Clients</Link>
      </p>
      <h1 className="mt-3 font-display text-3xl">
        {booking.customer_name ?? booking.customer_email}
      </h1>
      <p className="mt-1 font-sans text-sm text-ink/60">
        {(service as { name: string } | null)?.name}
        {avg && <> · 7-day avg weight: <strong>{avg} kg</strong></>}
      </p>

      {/* Intake */}
      <section className="mt-10">
        <h2 className="label mb-3 text-ink/50">Intake quiz</h2>
        <dl className="max-w-2xl border border-line font-sans text-sm">
          {Object.entries(intake).map(([key, value]) => (
            <div key={key} className="flex border-b border-line last:border-b-0">
              <dt className="w-44 shrink-0 border-r border-line bg-paper-raised px-3 py-2 text-xs uppercase tracking-wide text-ink/60">
                {key.replaceAll("_", " ")}
              </dt>
              <dd className="px-3 py-2">
                {Array.isArray(value) ? value.join(", ") : String(value) || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Programs */}
      <section className="mt-12">
        <h2 className="label mb-3 text-ink/50">Programs</h2>

        {(programs ?? []).map((p) => (
          <div key={p.id} className="mb-8 max-w-3xl border border-line p-6">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-xl">{p.title}</h3>
              <span className="label text-ink/50">{p.goal ?? ""}</span>
            </div>
            {p.notes && <p className="mt-1 text-sm text-ink/70">{p.notes}</p>}

            <div className="mt-4 space-y-4">
              {(p.program_days ?? [])
                .sort((a, b) => a.day_index - b.day_index)
                .map((d) => (
                  <div key={d.id} className="rule pt-4">
                    <p className="font-sans text-sm font-medium">
                      Day {d.day_index} — {d.title}
                    </p>
                    <ul className="mt-2 space-y-1 font-sans text-sm text-ink/80">
                      {(d.exercises ?? [])
                        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
                        .map((e) => (
                          <li key={e.id}>
                            {e.name} — {e.sets ?? "?"} × {e.reps ?? "?"}
                          </li>
                        ))}
                    </ul>
                    <form action={addExercise} className="mt-3 flex flex-wrap gap-2">
                      <input type="hidden" name="program_day_id" value={d.id} />
                      <input name="name" required placeholder="Exercise" className={inputClass} />
                      <input name="sets" type="number" placeholder="Sets" className={`${inputClass} w-20`} />
                      <input name="reps" placeholder="Reps (8-12)" className={`${inputClass} w-28`} />
                      <button type="submit" className="label text-terracotta hover:underline">
                        Add
                      </button>
                    </form>
                  </div>
                ))}
            </div>

            <form action={addDay} className="rule mt-5 flex flex-wrap gap-2 pt-5">
              <input type="hidden" name="program_id" value={p.id} />
              <input name="day_index" type="number" min={1} max={7} defaultValue={(p.program_days?.length ?? 0) + 1} className={`${inputClass} w-20`} />
              <input name="title" required placeholder="Day title (e.g. Push)" className={inputClass} />
              <Button variant="secondary" type="submit">Add day</Button>
            </form>
          </div>
        ))}

        <form action={createProgram} className="max-w-3xl border border-dashed border-line p-6">
          <p className="label mb-3 text-ink/50">New program</p>
          <div className="flex flex-wrap gap-2">
            <input name="title" required placeholder="Program title" className={inputClass} />
            <select name="goal" className={inputClass}>
              <option value="">Goal…</option>
              <option value="fat_loss">Fat loss</option>
              <option value="muscle">Muscle</option>
              <option value="general">General</option>
            </select>
            <input name="notes" placeholder="Notes" className={`${inputClass} flex-1`} />
            <Button variant="secondary" type="submit">Create</Button>
          </div>
        </form>
      </section>

      {/* Bodyweight log */}
      <section className="mt-12">
        <h2 className="label mb-3 text-ink/50">Recent weigh-ins</h2>
        {(weights ?? []).length > 0 ? (
          <ul className="max-w-md font-sans text-sm">
            {(weights ?? []).slice(0, 10).map((w) => (
              <li key={w.logged_on} className="rule flex justify-between py-2 first:border-t-0">
                <span className="text-ink/60">{w.logged_on}</span>
                <span>{Number(w.weight_kg).toFixed(1)} kg</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">No weigh-ins logged yet.</p>
        )}
      </section>
    </div>
  );
}
