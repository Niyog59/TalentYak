/*
 * Units, exactly.
 *
 * A number is stored with the unit it was entered in wherever the meaning
 * matters (a set's load, a body-weight entry), and converted only for
 * display or comparison. The factors are the exact international definitions,
 * not approximations: 1 lb = 0.45359237 kg, 1 in = 2.54 cm.
 */

export type WeightUnit = "kg" | "lb";
export type LengthUnit = "cm" | "in";

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return from === "lb" ? value * KG_PER_LB : value / KG_PER_LB;
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value;
  return from === "in" ? value * CM_PER_IN : value / CM_PER_IN;
}

/** "17.5", "20", "81.8" — trailing zeros dropped, at most `dp` places. */
export function trimNumber(n: number, dp = 1): string {
  return String(roundTo(n, dp));
}

/**
 * A number typed on a phone: "17.5", "17,5", " 20 ". Null for blank or
 * anything that is not a plain non-negative number.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseWhole(input: string | number | null | undefined): number | null {
  const n = parseAmount(input);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** A weight entered in one unit, shown in another, e.g. "81.8 kg". */
export function formatWeightIn(value: number, from: WeightUnit, to: WeightUnit): string {
  return `${trimNumber(convertWeight(value, from, to), 1)} ${to}`;
}

export function formatLengthIn(value: number, from: LengthUnit, to: LengthUnit): string {
  return `${trimNumber(convertLength(value, from, to), 1)} ${to}`;
}

/** A neutral change with a real minus sign. No verdict, no colour. */
export function formatDelta(delta: number, unit: string, dp = 1): string {
  const r = roundTo(delta, dp);
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${Math.abs(r)} ${unit}`;
}

export const WEIGHT_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };
