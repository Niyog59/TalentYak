import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";

export default async function AdminCatalogPage() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: services } = await supabase
    .from("services")
    .select("id, vertical_slug, name, price_cents, billing_type, status, sort")
    .order("vertical_slug")
    .order("sort");

  async function cycleStatus(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const id = String(formData.get("id"));
    const current = String(formData.get("status"));
    const next =
      current === "active"
        ? "coming_soon"
        : current === "coming_soon"
          ? "hidden"
          : "active";
    await admin.from("services").update({ status: next }).eq("id", id);
    revalidatePath("/admin/catalog");
    revalidatePath("/services");
    revalidatePath("/");
  }

  async function updatePrice(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const id = String(formData.get("id"));
    const dollars = parseFloat(String(formData.get("price") || "0"));
    if (!Number.isFinite(dollars) || dollars <= 0) return;
    await admin
      .from("services")
      .update({ price_cents: Math.round(dollars * 100) })
      .eq("id", id);
    revalidatePath("/admin/catalog");
    revalidatePath("/services");
  }

  const rows = services ?? [];

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl">Catalog</h1>
      <p className="mt-2 max-w-xl font-sans text-sm text-ink/60">
        Services live in the database once Supabase is connected (run
        supabase/seed.sql). Status cycles active → coming soon → hidden.
        Prices update immediately on the site.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-ink/60">
          No services in the database yet — the site is serving registry seed
          data. Run supabase/seed.sql to manage the catalog from here.
        </p>
      ) : (
        <table className="mt-8 w-full border-collapse font-sans text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="label py-3 pr-4 font-medium text-ink/50">Service</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">Vertical</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">Billing</th>
              <th className="label py-3 pr-4 font-medium text-ink/50">Price</th>
              <th className="label py-3 font-medium text-ink/50">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line">
                <td className="py-3 pr-4">{s.name}</td>
                <td className="py-3 pr-4 text-ink/60">{s.vertical_slug}</td>
                <td className="py-3 pr-4 text-ink/60">{s.billing_type}</td>
                <td className="py-3 pr-4">
                  <form action={updatePrice} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <span className="text-ink/60">$</span>
                    <input
                      name="price"
                      defaultValue={(s.price_cents / 100).toFixed(2)}
                      className="w-20 rounded-[3px] border border-line bg-white/60 px-2 py-1"
                    />
                    <button type="submit" className="label text-ink/50 hover:text-terracotta">
                      Save
                    </button>
                  </form>
                </td>
                <td className="py-3">
                  <form action={cycleStatus}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="status" value={s.status} />
                    <button type="submit" className="label hover:text-terracotta">
                      {s.status}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
