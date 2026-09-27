import {
  ARRANGEMENT_FIELDS,
  LIST_FIELDS,
  PLATFORM_FIELDS,
  policyLinkLabel,
  type CoachExpectationsContent,
  type PlatformExpectationsContent,
} from "@/lib/expectations/types";

/**
 * What changed between two versions, section by section, in words a client can
 * read. Text fields are shown whole (before and after) rather than as a
 * character diff: a reader needs to see the sentence, not the edit.
 */

export type Change =
  | { kind: "text"; section: string; label: string; before: string; after: string }
  | { kind: "list"; section: string; label: string; added: string[]; removed: string[] };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function listChange(section: string, label: string, before: string[], after: string[]): Change | null {
  const b = new Set(before.map(norm));
  const a = new Set(after.map(norm));
  const added = after.filter((x) => !b.has(norm(x)));
  const removed = before.filter((x) => !a.has(norm(x)));
  return added.length || removed.length ? { kind: "list", section, label, added, removed } : null;
}

export function diffCoach(before: CoachExpectationsContent, after: CoachExpectationsContent): Change[] {
  const section = "Your coaching arrangement";
  const out: Change[] = [];
  for (const f of ARRANGEMENT_FIELDS) {
    if (norm(before[f.key]) !== norm(after[f.key])) {
      out.push({ kind: "text", section, label: f.label, before: before[f.key], after: after[f.key] });
    }
  }
  for (const f of LIST_FIELDS) {
    const c = listChange(f.key === "client_part" ? "Your part as a client" : "Your coach's part", f.label, before[f.key], after[f.key]);
    if (c) out.push(c);
  }
  return out;
}

export function diffPlatform(before: PlatformExpectationsContent, after: PlatformExpectationsContent): Change[] {
  const section = "TalentYak essentials";
  const out: Change[] = [];
  for (const f of PLATFORM_FIELDS) {
    if (norm(before[f.key]) !== norm(after[f.key])) {
      out.push({ kind: "text", section, label: f.label, before: before[f.key], after: after[f.key] });
    }
  }
  const label = (h: string) => policyLinkLabel(h) ?? h;
  const c = listChange(section, "Policy links", before.policy_links.map(label), after.policy_links.map(label));
  if (c) out.push(c);
  return out;
}
