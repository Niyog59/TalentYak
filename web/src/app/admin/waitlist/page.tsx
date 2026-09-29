import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton } from "@/components/form/fields";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { purchaseMode } from "@/lib/launch";
import { sendWaitlistNoticeAction } from "@/lib/waitlist/actions";

export const metadata = { title: "Waitlist" };
export const dynamic = "force-dynamic";

/*
 * The minimum a founder needs (M16): who is waiting and for whom, and a way to
 * send one availability notice by hand. Nothing is sent automatically, a
 * notice reserves nothing, and broader operations belong to M17.
 */
export default async function AdminWaitlistPage() {
  await requireAdmin("/admin/waitlist");
  const supabase = (await createClient())!;
  const [{ data: entries, error }, { data: coaches }, { data: avail }, { data: notices }] = await Promise.all([
    supabase.from("waitlist_entries").select("id, email, first_name, provider_id, offer_id, state, created_at, confirmed_at, last_notified_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("public_coach_directory").select("provider_id, display_name"),
    supabase.rpc("coach_public_availability"),
    supabase.from("waitlist_notices").select("id, provider_id, recipients, created_at").order("created_at", { ascending: false }).limit(10),
  ]);
  const name = (id: string | null) => (id ? (coaches ?? []).find((c) => c.provider_id === id)?.display_name ?? "A coach no longer public" : "Any coach");
  const available = ((avail ?? []) as { provider_id: string; state: string }[]).filter((a) => a.state === "available");
  const list = entries ?? [];
  const confirmed = list.filter((e) => e.state === "confirmed");
  const open = await purchaseMode(null) !== "closed";

  return (
    <div>
      <PageHeader title="Waitlist">
        People who asked to be told when coaching can be bought. Email addresses are visible only here, to administrators.
      </PageHeader>

      <Panel title="At a glance" id="summary">
        {error ? (
          <p role="alert">The waitlist couldn&rsquo;t be loaded. Refresh to try again.</p>
        ) : (
          <p>
            <strong>{confirmed.length}</strong> confirmed · <strong>{list.length - confirmed.length}</strong> not yet confirmed (they get nothing until they confirm)
          </p>
        )}
      </Panel>

      <Panel
        title="Send an availability notice"
        id="notice"
        description="One email to each confirmed person who asked about this coach (or about any coach). It says coaching can be bought now, that it doesn't reserve a place, and how to leave the list. It's sent only when you press the button."
      >
        {!open ? (
          <p className="rounded-lg border border-line-strong bg-paper-raised p-4">
            Buying isn&rsquo;t open to the public yet, so there&rsquo;s nothing to announce. This becomes available once live purchasing is switched on.
          </p>
        ) : (
          <ActionForm action={sendWaitlistNoticeAction} className="grid gap-4 sm:max-w-lg">
            <SelectField
              name="coach"
              label="About"
              required={false}
              options={[{ value: "", label: "TalentYak is open (everyone confirmed)" }, ...available.map((a) => ({ value: a.provider_id, label: `${name(a.provider_id)} is taking new clients` }))]}
            />
            <CheckboxField name="confirm" required label="Send it now. I understand this emails real people and can't be undone." />
            <div><SubmitButton pendingLabel="Queueing…">Send notice</SubmitButton></div>
          </ActionForm>
        )}
        {(notices ?? []).length ? (
          <ul className="mt-5 text-sm text-ink-muted">
            {(notices ?? []).map((n) => <li key={n.id}>{formatDate(n.created_at, null, true)} · {name(n.provider_id)} · {n.recipients} recipient{n.recipients === 1 ? "" : "s"}</li>)}
          </ul>
        ) : null}
      </Panel>

      <Panel title="Entries" id="entries" description="Newest first. Withdrawing deletes an entry, so it disappears from here.">
        <DataTable
          caption="Waitlist entries"
          head={["Email", "Name", "Interested in", "State", "Joined", "Last notified"]}
          empty="Nobody has joined yet."
          rows={list.map((e) => [
            e.email,
            e.first_name ?? "—",
            name(e.provider_id),
            e.state === "confirmed" ? `Confirmed ${formatDate(e.confirmed_at, null)}` : "Not confirmed",
            formatDate(e.created_at, null),
            e.last_notified_at ? formatDate(e.last_notified_at, null) : "—",
          ])}
        />
      </Panel>
    </div>
  );
}
