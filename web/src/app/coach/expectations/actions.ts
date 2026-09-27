"use server";

import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { cleanList, cleanText } from "@/lib/expectations/text";
import {
  ARRANGEMENT_FIELDS,
  LIST_FIELDS,
  expectationsError,
  missingCoachFields,
  type CoachExpectationsContent,
} from "@/lib/expectations/types";

/*
 * The coach edits and publishes their own section through their own session.
 * The database functions decide who may, keep a published version frozen, and
 * present a meaningful revision to current clients. This file validates input
 * and turns refusals into words; it is not the security boundary.
 */

function readContent(form: FormData): CoachExpectationsContent {
  const content = {} as CoachExpectationsContent;
  for (const f of ARRANGEMENT_FIELDS) content[f.key] = cleanText(form.get(f.key), f.max);
  for (const f of LIST_FIELDS) content[f.key] = cleanList(form.get(f.key), f.max, f.itemMax);
  return content;
}

export async function saveExpectationsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/expectations");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");

  const limit = await rateLimit("expectations_save", session.userId, 30, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const content = readContent(form);
  const intent = form.get("intent") === "publish" ? "publish" : "save";

  const { data: draftId, error } = await supabase.rpc("save_my_expectations_draft", { p: content });
  if (error || !draftId) return fail(expectationsError(error?.message, "That didn't save. Please try again."));

  if (intent === "save") {
    revalidatePath("/coach/expectations");
    return succeed("Draft saved. Clients see nothing until you publish.");
  }

  const missing = missingCoachFields(content);
  if (missing.length) {
    revalidatePath("/coach/expectations");
    return fail(`Draft saved, but not published. Still to fill in: ${missing.join("; ")}.`);
  }

  const material = form.get("material") === "on";
  const summary = cleanText(form.get("change_summary"), 500);
  const { data: published, error: publishError } = await supabase.rpc("publish_my_expectations", {
    p_draft: draftId,
    p_material: material,
    p_summary: summary || null,
  });
  if (publishError || !published) {
    revalidatePath("/coach/expectations");
    return fail(expectationsError(publishError?.message, "Draft saved, but publishing failed. Please try again."));
  }

  revalidatePath("/coach/expectations");
  revalidatePath("/coach");
  const r = published as { version: number; presented: number };
  return succeed(
    `Version ${r.version} is published.` +
      (r.presented ? ` ${r.presented} current client${r.presented === 1 ? " has" : "s have"} been sent it${material ? " and asked to read it" : ""}.` : ""),
  );
}

export async function discardExpectationsDraftAction(_: ActionState, _form: FormData): Promise<ActionState> {
  await requireCoach("/coach/expectations");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("discard_my_expectations_draft");
  if (error) return fail(expectationsError(error.message, "That didn't work. Please try again."));
  revalidatePath("/coach/expectations");
  return succeed("Draft discarded.");
}
