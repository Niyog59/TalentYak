export type BookingStatus =
  | "requested"
  | "confirmed"
  | "scheduled"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded";

/**
 * The one status machine every vertical shares.
 * requested -> confirmed -> scheduled -> delivered -> completed
 * cancelled/refunded are exits; refund only after money moved.
 */
const transitions: Record<BookingStatus, BookingStatus[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["scheduled", "cancelled", "refunded"],
  scheduled: ["delivered", "cancelled", "refunded"],
  delivered: ["completed", "refunded"],
  completed: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function canTransition(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function nextStatuses(from: BookingStatus): BookingStatus[] {
  return transitions[from] ?? [];
}

export const statusLabels: Record<BookingStatus, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};
