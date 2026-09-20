import type { Metadata } from "next";
import { requireOnboarded } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/button";
import { PageHeader, Panel } from "@/components/ui/panel";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";
import { savePreferencesAction } from "../actions";

export const metadata: Metadata = { title: "Email settings" };
export const dynamic = "force-dynamic";

interface Category {
  id: string;
  label: string;
  description: string;
  essential: boolean;
  default_email: boolean;
  sort_order: number;
}

export default async function NotificationPreferencesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
        <h1 className="font-display text-5xl">Email settings</h1>
        <p className="mt-4 text-lg text-ink-muted">Accounts aren&rsquo;t available in this environment.</p>
      </div>
    );
  }

  await requireOnboarded("/account/notifications/preferences");
  const supabase = (await createClient())!;

  const [{ data: categories }, { data: preferences }] = await Promise.all([
    supabase
      .from("notification_categories")
      .select("id, label, description, essential, default_email, sort_order")
      .order("sort_order"),
    supabase.from("notification_preferences").select("category_id, email_enabled"),
  ]);

  const all = (categories ?? []) as Category[];
  const essential = all.filter((c) => c.essential);
  const optional = all.filter((c) => !c.essential);

  // A row exists only where this person differs from the category default.
  const enabled = (c: Category) =>
    preferences?.find((p) => p.category_id === c.id)?.email_enabled ?? c.default_email;

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
      <PageHeader title="Email settings">
        <p>
          What reaches your email. Everything still appears in your notifications either way —
          turning an email off changes how you are told, not whether you are told.
        </p>
      </PageHeader>

      <nav aria-label="Account" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/account/notifications" variant="secondary" size="sm">Notifications</ButtonLink>
        <ButtonLink href="/account" variant="secondary" size="sm">Your account</ButtonLink>
      </nav>

      <Panel title="You can choose these" className="mt-8">
        <ActionForm action={savePreferencesAction} noticeFirst>
          <div className="space-y-5">
            {optional.map((c) => (
              <CheckboxField
                key={c.id}
                name={`category:${c.id}`}
                label={c.label}
                help={c.description}
                defaultChecked={enabled(c)}
              />
            ))}
          </div>
          <div className="mt-6">
            <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel
        title="These always come by email"
        description="How your account is kept safe and paid for. There is no switch for these, so we don't show one that would do nothing."
        className="mt-6"
      >
        <ul className="space-y-4">
          {essential.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Icon name="lock" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-ink-muted">{c.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
