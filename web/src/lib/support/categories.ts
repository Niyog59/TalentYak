/** What a support case can be about. Mirrors the check constraint in 0037. */
export const SUPPORT_CATEGORIES = [
  { value: "conduct", label: "Something said or done in a conversation" },
  { value: "safety", label: "I feel unsafe or someone may be at risk" },
  { value: "billing", label: "Payment or billing" },
  { value: "coach_change", label: "Changing coach" },
  { value: "technical", label: "Something isn't working" },
  { value: "other", label: "Something else" },
] as const;

export const CASE_STATE_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "Being looked at",
  resolved: "Resolved",
};

export function categoryLabel(value: string): string {
  return SUPPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
