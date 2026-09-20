import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/panel";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { formatDate } from "@/lib/format";
import { markAllReadAction, markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  category_id: string;
  title: string;
  body: string | null;
  path: string | null;
  read_at: string | null;
  created_at: string;
}

export default async function NotificationsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
        <h1 className="font-display text-5xl">Notifications</h1>
        <p className="mt-4 text-lg text-ink-muted">Accounts aren&rsquo;t available in this environment.</p>
      </div>
    );
  }

  const session = await requireOnboarded("/account/notifications");
  const supabase = (await createClient())!;

  // Row-level security restricts this to the signed-in person. There is no
  // profile filter here because there does not need to be one, and adding it
  // would suggest the database was not already enforcing it.
  const [{ data: notifications }, { data: categories }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, category_id, title, body, path, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("notification_categories").select("id, label"),
  ]);

  const rows = (notifications ?? []) as Row[];
  const unread = rows.filter((r) => !r.read_at).length;
  const labelFor = (id: string) => categories?.find((c) => c.id === id)?.label ?? "Notification";

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <PageHeader title="Notifications">
        <p>
          Everything that has happened on your account. This is the full record —{" "}
          <Link href="/account/notifications/preferences" className="underline underline-offset-4">
            switching off an email
          </Link>{" "}
          stops the email, not the entry here.
        </p>
      </PageHeader>

      <nav aria-label="Account" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/account" variant="secondary" size="sm">Your account</ButtonLink>
        <ButtonLink href="/account/notifications/preferences" variant="secondary" size="sm">Email settings</ButtonLink>
      </nav>

      {unread > 0 ? (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <p className="font-medium">
            {unread === 1 ? "1 unread notification" : `${unread} unread notifications`}
          </p>
          <ActionForm action={markAllReadAction}>
            <SubmitButton variant="secondary" pendingLabel="Marking…">Mark all as read</SubmitButton>
          </ActionForm>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon="info" title="Nothing yet" className="mt-8">
          When something happens on your account — a payment, a change to your coaching, a booked
          session — it will appear here.
        </EmptyState>
      ) : (
        <ul className="mt-8 space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`rounded-xl border p-4 ${
                row.read_at ? "border-line bg-surface" : "border-brand/40 bg-brand-tint"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink-muted">{labelFor(row.category_id)}</p>
                <p className="text-sm text-ink-muted">
                  <time dateTime={row.created_at}>{formatDate(row.created_at, session.profile.timezone, true)}</time>
                </p>
              </div>

              <h2 className="mt-1 text-lg font-semibold">
                {row.path ? (
                  <Link href={row.path} className="underline-offset-4 hover:underline">
                    {row.title}
                  </Link>
                ) : (
                  row.title
                )}
              </h2>

              {row.body ? <p className="mt-1 text-ink-muted">{row.body}</p> : null}

              {row.read_at ? null : (
                <ActionForm action={markReadAction} className="mt-3">
                  <input type="hidden" name="notification_id" value={row.id} />
                  <SubmitButton variant="quiet" pendingLabel="Marking…">Mark as read</SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
