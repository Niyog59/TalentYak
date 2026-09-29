"use client";

import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import type { HeldState, SaveState } from "@/lib/tracking/device";

/*
 * Where an entry stands, in words. "Saved" appears only after the server said
 * so; anything else says plainly that the entry is on this device only.
 */

export function heldMessage(reason: HeldState): string {
  switch (reason) {
    case "ended":
      return "This coaching has ended, so new entries can't be saved. Everything already saved stays readable.";
    case "suspended":
      return "Your account is suspended, so new entries can't be saved right now. Contact support if you have questions.";
    case "paused":
      return "Coaching is paused, so new entries wait on this device until it resumes.";
    case "logging_paused":
      return "Saving is paused by TalentYak for a short while. Your entries are kept on this device and save automatically when it's back.";
    default:
      return "Coaching isn't active right now (for example, during a coach change), so new entries wait on this device.";
  }
}

export function SaveBadge({ state, onRetry, neverSaved = false }: { state: SaveState; onRetry?: () => void; neverSaved?: boolean }) {
  let text: string;
  let tone = "text-ink-muted";
  let retry = false;
  switch (state.kind) {
    case "saved":
      text = neverSaved ? "Nothing recorded yet" : "Saved";
      tone = neverSaved ? "text-ink-muted" : "text-brand";
      break;
    case "saving":
      text = "Saving…";
      break;
    case "pending":
      text = "Saving shortly — kept on this device";
      break;
    case "offline":
      text = "No connection — kept on this device, will save when you're back online";
      tone = "text-ink";
      retry = true;
      break;
    case "held":
      text = state.reason === "paused" ? "Coaching paused — kept on this device" : "Not saved — kept on this device";
      tone = "text-danger";
      retry = true;
      break;
    case "conflict":
      text = "Changed on another device — choose below";
      tone = "text-danger";
      break;
    case "failed":
      text = `Not saved — ${state.message}`;
      tone = "text-danger";
      retry = state.retryable;
      break;
  }
  return (
    <span className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${tone}`} role="status" aria-live="polite">
      {state.kind === "saved" && !neverSaved ? <Icon name="check" className="size-4" /> : state.kind === "saving" || state.kind === "pending" ? null : <Icon name="alert" className="size-4" />}
      <span>{text}</span>
      {retry && onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
      ) : null}
    </span>
  );
}
