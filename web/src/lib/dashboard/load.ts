/*
 * Each dashboard section loads on its own. A section that fails says so and
 * offers a retry; the others carry on. A failure is never shown as "nothing
 * to do" — an empty list and a list that couldn't be read look different.
 *
 * Only the section's name is logged, never what it contained.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false };

export async function attempt<T>(section: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    console.error(`[dashboard] ${section} could not be loaded:`, e instanceof QueryFailed ? e.code : "unexpected");
    return { ok: false };
  }
}

export class QueryFailed extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** A query's rows, or a thrown failure — so a refused read never reads as "none". */
export function rows<T>(r: { data: T; error: { code?: string } | null }): T {
  if (r.error) throw new QueryFailed(r.error.code ?? "query_failed");
  return r.data;
}
