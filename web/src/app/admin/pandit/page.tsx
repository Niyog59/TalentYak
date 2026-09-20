import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { enqueueShraddhaReminder } from "@/lib/jobs";
import {
  bsMonths,
  pakshas,
  tithiNames,
  todayInBs,
  formatTithi,
} from "@/verticals/pandit/tithi";
import { Button } from "@/components/button";

const inputClass =
  "rounded-[3px] border border-line bg-white/60 px-3 py-2 font-sans text-sm";

export default async function AdminPanditPage() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: dates } = await supabase
    .from("shraddha_dates")
    .select("*")
    .order("next_gregorian_date", { ascending: true, nullsFirst: false });

  const { data: panditBookings } = await supabase
    .from("bookings")
    .select("id, status, customer_name, customer_email, scheduled_at, services(name)")
    .eq("vertical_slug", "pandit")
    .in("status", ["requested", "confirmed", "scheduled"])
    .order("created_at", { ascending: false });

  async function addShraddhaDate(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("shraddha_dates").insert({
      customer_email: String(formData.get("customer_email") || "").trim(),
      customer_name: String(formData.get("customer_name") || "") || null,
      deceased_name: String(formData.get("deceased_name") || "").trim(),
      relation: String(formData.get("relation") || "") || null,
      gotra: String(formData.get("gotra") || "") || null,
      tradition: String(formData.get("tradition") || "") || null,
      tithi_month_bs: String(formData.get("tithi_month_bs") || "") || null,
      tithi_paksha: String(formData.get("tithi_paksha") || "") || null,
      tithi_name: String(formData.get("tithi_name") || "") || null,
    });
    revalidatePath("/admin/pandit");
  }

  async function confirmDate(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const id = String(formData.get("id"));
    const date = String(formData.get("next_gregorian_date") || "");
    if (!date) return;
    await admin
      .from("shraddha_dates")
      .update({
        next_gregorian_date: date,
        date_confirmed_by_human: true,
        reminder_scheduled: false,
      })
      .eq("id", id);
    revalidatePath("/admin/pandit");
  }

  async function scheduleReminder(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const id = String(formData.get("id"));
    const { data: row } = await admin
      .from("shraddha_dates")
      .select("*")
      .eq("id", id)
      .single();
    // Reminders only go out for human-confirmed dates (handover rule).
    if (!row || !row.next_gregorian_date || !row.date_confirmed_by_human) return;

    const ceremonyDate = new Date(`${row.next_gregorian_date}T00:00:00Z`);
    const remindAt = new Date(ceremonyDate);
    remindAt.setUTCDate(remindAt.getUTCDate() - 21);

    const dateText = ceremonyDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });

    await enqueueShraddhaReminder({
      email: row.customer_email,
      customerName: row.customer_name ?? null,
      rememberedName: row.deceased_name,
      tithi: formatTithi(row),
      dateText,
      scheduledFor: remindAt < new Date() ? new Date() : remindAt,
      shraddhaDateId: row.id,
    });

    await admin
      .from("shraddha_dates")
      .update({ reminder_scheduled: true })
      .eq("id", id);
    revalidatePath("/admin/pandit");
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl">Ceremonies &amp; Rites</h1>
        <p className="label text-ink/50">Today (BS): {todayInBs()}</p>
      </div>

      {/* Active pandit bookings */}
      <section className="mt-10">
        <h2 className="label mb-4 text-ink/50">Open bookings</h2>
        {(panditBookings ?? []).length > 0 ? (
          <ul className="max-w-3xl font-sans text-sm">
            {(panditBookings ?? []).map((b) => {
              const service = Array.isArray(b.services) ? b.services[0] : b.services;
              return (
                <li key={b.id} className="rule flex items-baseline justify-between py-3 first:border-t-0">
                  <Link href={`/admin/bookings/${b.id}`} className="hover:text-terracotta">
                    {(service as { name: string } | null)?.name}
                    <span className="text-ink/50"> · {b.customer_name ?? b.customer_email}</span>
                  </Link>
                  <span className="label text-ink/50">{b.status}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">No open ceremony bookings.</p>
        )}
      </section>

      {/* Tithi database */}
      <section className="mt-14">
        <h2 className="label mb-1 text-ink/50">Tithi database</h2>
        <p className="mb-6 max-w-2xl font-sans text-xs leading-relaxed text-ink/60">
          One row per remembered ancestor. Enter the Gregorian date for the
          coming year and confirm it — reminders can only be scheduled for
          human-confirmed dates, and go out 21 days before.
        </p>

        <form
          action={addShraddhaDate}
          className="grid max-w-3xl grid-cols-2 gap-3 border border-line p-5 sm:grid-cols-3"
        >
          <input name="customer_email" required type="email" placeholder="Customer email *" className={inputClass} />
          <input name="customer_name" placeholder="Customer name" className={inputClass} />
          <input name="deceased_name" required placeholder="Deceased name *" className={inputClass} />
          <input name="relation" placeholder="Relation" className={inputClass} />
          <input name="gotra" placeholder="Gotra" className={inputClass} />
          <select name="tradition" className={inputClass}>
            <option value="">Tradition…</option>
            <option value="khas">Khas / Parbatiya</option>
            <option value="newar">Newar</option>
            <option value="other">Other</option>
          </select>
          <select name="tithi_month_bs" className={inputClass}>
            <option value="">BS month…</option>
            {bsMonths.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select name="tithi_paksha" className={inputClass}>
            <option value="">Paksha…</option>
            {pakshas.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <select name="tithi_name" className={inputClass}>
            <option value="">Tithi…</option>
            {tithiNames.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="col-span-2 sm:col-span-3">
            <Button variant="secondary" type="submit">Add ancestor</Button>
          </div>
        </form>

        <table className="mt-8 w-full border-collapse font-sans text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label py-3 pr-4 font-medium text-ink/50">Ancestor</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">Family</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">Tithi</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">This year</th>
              <th className="label py-3 font-medium text-ink/50">Reminder</th>
            </tr>
          </thead>
          <tbody>
            {(dates ?? []).map((d) => (
              <tr key={d.id} className="border-b border-line align-top">
                <td className="py-3 pr-4">
                  {d.deceased_name}
                  {d.relation && <span className="text-ink/50"> ({d.relation})</span>}
                </td>
                <td className="py-3 pr-4 text-ink/60">
                  {d.customer_name ?? d.customer_email}
                </td>
                <td className="py-3 pr-4 text-ink/60">{formatTithi(d)}</td>
                <td className="py-3 pr-4">
                  <form action={confirmDate} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={d.id} />
                    <input
                      type="date"
                      name="next_gregorian_date"
                      defaultValue={d.next_gregorian_date ?? ""}
                      className={inputClass}
                    />
                    <button type="submit" className="label text-ink/50 hover:text-terracotta">
                      {d.date_confirmed_by_human ? "Confirmed ✓" : "Confirm"}
                    </button>
                  </form>
                </td>
                <td className="py-3">
                  {d.reminder_scheduled ? (
                    <span className="label text-ink/40">Scheduled</span>
                  ) : d.date_confirmed_by_human && d.next_gregorian_date ? (
                    <form action={scheduleReminder}>
                      <input type="hidden" name="id" value={d.id} />
                      <button type="submit" className="label text-terracotta hover:underline">
                        Schedule
                      </button>
                    </form>
                  ) : (
                    <span className="label text-ink/30">Needs confirmed date</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(dates ?? []).length === 0 && (
          <p className="mt-4 text-sm text-ink/60">No ancestors recorded yet.</p>
        )}
      </section>
    </div>
  );
}
