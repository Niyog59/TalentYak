/**
 * Coach- and admin-authored text is hostile input. It is stored and rendered as
 * plain text — React escapes it, nothing is ever passed through as HTML, and
 * nothing is turned into a link or an embed. On top of that, this removes the
 * invisible characters that can make text display differently from what it
 * says: bidirectional overrides (which can reverse a line on screen), zero-width
 * characters, and other control characters.
 */

// C0/C1 controls except tab and newline; bidi embeddings, overrides and
// isolates; zero-width space/joiners; BOM.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** One point per line; blank lines dropped; each point capped. */
export function cleanList(input: unknown, maxItems: number, itemMax: number): string[] {
  if (typeof input !== "string") return [];
  return input
    .split("\n")
    .map((line) => cleanText(line.replace(/^\s*[-*•]\s*/, ""), itemMax))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Paragraphs for display. */
export function paragraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
