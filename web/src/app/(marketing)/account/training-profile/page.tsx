import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";
import { saveTrainingProfileAction } from "@/lib/programmes/actions";
import { EQUIPMENT_LABEL, EXPERIENCE_LABEL } from "@/lib/programmes/labels";
import type { HealthProfile, TrainingProfile } from "@/lib/programmes/server";

export const metadata: Metadata = { title: "Training & food profile" };
export const dynamic = "force-dynamic";

export default async function TrainingProfilePage() {
  const session = await requireOnboarded("/account/training-profile");
  const supabase = (await createClient())!;
  const [{ data: t }, { data: h }] = await Promise.all([
    supabase.from("client_training_profiles").select("*").eq("customer_id", session.userId).maybeSingle(),
    supabase.from("client_health_profiles").select("*").eq("customer_id", session.userId).maybeSingle(),
  ]);
  const training = t as TrainingProfile | null;
  const health = h as HealthProfile | null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-16">
      <p><Link href="/account/plan" className="text-brand underline underline-offset-4">← Your plan</Link></p>
      <h1 className="mt-4 font-display text-4xl">Your training &amp; food profile</h1>
      <p className="mt-3 text-lg text-ink-muted">
        Helps your coach plan workouts and meals that fit your life. Answer what you like, and update it whenever things change. Only you and your current coach can see it.
      </p>

      <ActionForm action={saveTrainingProfileAction} className="mt-8 space-y-8" noticeFirst>
        <fieldset className="space-y-5">
          <legend className="text-xl font-semibold">Training</legend>
          <SelectField
            name="experience"
            label="Training experience"
            defaultValue={training?.experience ?? ""}
            options={[{ value: "", label: "Choose…" }, ...Object.entries(EXPERIENCE_LABEL).map(([value, label]) => ({ value, label }))]}
          />
          <TextArea name="experience_note" label="Anything about your training history" rows={2} maxLength={500} defaultValue={training?.experience_note ?? ""} />
          <fieldset>
            <legend className="font-semibold">Equipment you can use <span className="font-normal text-ink-muted">(optional)</span></legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Object.entries(EQUIPMENT_LABEL).map(([value, label]) => (
                <CheckboxField key={value} name="equipment" value={value} label={label} defaultChecked={training?.equipment.includes(value)} />
              ))}
            </div>
          </fieldset>
          <TextArea name="equipment_note" label="More about equipment" rows={2} maxLength={500} defaultValue={training?.equipment_note ?? ""} help="e.g. dumbbells up to 10 kg, a gym near work" />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField name="session_minutes" label="Time per session" type="number" inputMode="numeric" min={10} max={240} defaultValue={training?.session_minutes ?? ""} help="Minutes" />
            <SelectField
              name="days_per_week"
              label="Days a week you can train"
              defaultValue={training?.days_per_week ? String(training.days_per_week) : ""}
              options={[{ value: "", label: "Choose…" }, ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }))]}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="text-xl font-semibold">Food</legend>
          <TextArea name="food_preferences" label="How you eat and what you prefer" rows={3} maxLength={1000} defaultValue={training?.food_preferences ?? ""} help="e.g. vegetarian, dal bhat most evenings, no beef" />
          <TextArea name="local_foods" label="Foods that are easy and affordable where you live" rows={3} maxLength={1000} defaultValue={training?.local_foods ?? ""} help="e.g. what your local shop sells, what you cook at home" />
        </fieldset>

        <fieldset className="space-y-5 rounded-2xl border border-line-strong bg-paper-raised p-4 sm:p-5">
          <legend className="flex items-center gap-2 px-1 text-xl font-semibold"><Icon name="lock" className="size-5" /> Health notes</legend>
          <p className="text-ink-muted">Private: only you and your current coach. TalentYak staff can&rsquo;t read these, and a previous coach loses access when you change coach.</p>
          <TextArea name="limitations" label="Injuries, pain or limitations" rows={3} maxLength={2000} defaultValue={health?.limitations ?? ""} help="Anything your coach should plan around." />
          <TextArea name="allergies" label="Food allergies and intolerances" rows={2} maxLength={1000} defaultValue={health?.allergies ?? ""} />
          <p className="text-sm">Your coach gives general fitness and nutrition guidance, not medical care. For a medical condition, please follow your doctor&rsquo;s advice.</p>
        </fieldset>

        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </ActionForm>
    </div>
  );
}
