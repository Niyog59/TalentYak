import NepaliDate from "nepali-date-converter";

/**
 * Tithi support. The lunar tithi identity (BS month + paksha + tithi)
 * is stored once per ancestor. Converting it to a Gregorian date for a
 * given year requires a lunar almanac (panchanga) — which is exactly
 * why the handover mandates HUMAN CONFIRMATION of every date before a
 * reminder is sent. These helpers assist the admin; they never schedule
 * anything on their own.
 */

export const bsMonths = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const pakshas = [
  { value: "shukla", label: "Shukla paksha (waxing)" },
  { value: "krishna", label: "Krishna paksha (waning)" },
] as const;

export const tithiNames = [
  "Pratipada",
  "Dwitiya",
  "Tritiya",
  "Chaturthi",
  "Panchami",
  "Shashthi",
  "Saptami",
  "Ashtami",
  "Navami",
  "Dashami",
  "Ekadashi",
  "Dwadashi",
  "Trayodashi",
  "Chaturdashi",
  "Purnima",
  "Aunsi",
] as const;

/** Today's date in Bikram Sambat, for admin display. */
export function todayInBs(): string {
  const now = new NepaliDate();
  return now.format("YYYY MMMM DD");
}

/** Formats a stored tithi identity for display. */
export function formatTithi(row: {
  tithi_month_bs: string | null;
  tithi_paksha: string | null;
  tithi_name: string | null;
}): string {
  if (!row.tithi_month_bs && !row.tithi_name) return "not recorded";
  return [row.tithi_month_bs, row.tithi_paksha, row.tithi_name]
    .filter(Boolean)
    .join(" ");
}
