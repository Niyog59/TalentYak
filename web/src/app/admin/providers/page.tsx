import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { getModules } from "@/verticals/registry";
import { Button } from "@/components/button";

const inputClass =
  "w-full rounded-[3px] border border-line bg-white/60 px-3 py-2 font-sans text-sm";

export default async function AdminProvidersPage() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: providers } = await supabase
    .from("providers")
    .select("*")
    .order("created_at", { ascending: false });

  const verticalOptions = getModules().map((m) => m.vertical);

  async function createProvider(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    await admin.from("providers").insert({
      display_name: String(formData.get("display_name") || "").trim(),
      vertical_slug: String(formData.get("vertical_slug") || ""),
      payout_reference: String(formData.get("payout_reference") || "") || null,
      founding: formData.get("founding") === "on",
      notes: String(formData.get("notes") || "") || null,
    });
    revalidatePath("/admin/providers");
  }

  async function toggleActive(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const providerId = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await admin.from("providers").update({ active: !active }).eq("id", providerId);
    revalidatePath("/admin/providers");
  }

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl">Providers</h1>

      <section className="mt-8 max-w-xl border border-line p-6">
        <h2 className="label mb-4 text-ink/50">Add provider</h2>
        <form action={createProvider} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <input
              name="display_name"
              required
              placeholder="Display name"
              className={inputClass}
            />
            <select name="vertical_slug" required className={inputClass}>
              {verticalOptions.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <input
            name="payout_reference"
            placeholder="Payoneer / bank reference"
            className={inputClass}
          />
          <input name="notes" placeholder="Notes" className={inputClass} />
          <label className="flex items-center gap-2 font-sans text-sm">
            <input type="checkbox" name="founding" className="accent-[#1B2A4A]" />
            Founding provider (65% fitness split)
          </label>
          <Button type="submit" variant="secondary">
            Add provider
          </Button>
        </form>
      </section>

      <table className="mt-10 w-full border-collapse font-sans text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="label py-3 pr-4 font-medium text-ink/50">Name</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Vertical</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Payout ref</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Founding</th>
            <th className="label py-3 font-medium text-ink/50">Status</th>
          </tr>
        </thead>
        <tbody>
          {(providers ?? []).map((p) => (
            <tr key={p.id} className="border-b border-line">
              <td className="py-3 pr-4">{p.display_name}</td>
              <td className="py-3 pr-4 text-ink/60">{p.vertical_slug}</td>
              <td className="py-3 pr-4 text-ink/60">{p.payout_reference ?? "—"}</td>
              <td className="py-3 pr-4">{p.founding ? "Yes" : "—"}</td>
              <td className="py-3">
                <form action={toggleActive}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={String(p.active)} />
                  <button
                    type="submit"
                    className={`label ${p.active ? "text-ink" : "text-ink/40"} hover:text-terracotta`}
                  >
                    {p.active ? "Active" : "Inactive"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(providers ?? []).length === 0 && (
        <p className="mt-6 text-sm text-ink/60">No providers yet.</p>
      )}
    </div>
  );
}
