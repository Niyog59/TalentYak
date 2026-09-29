/** A value that was read, or an honest reason it wasn't. Never a silent zero. */
export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string };

export const loaded = <T,>(value: T): Loaded<T> => ({ ok: true, value });
export const failed = <T,>(reason = "Couldn't be loaded"): Loaded<T> => ({ ok: false, reason });

/** Runs a read and turns a failure into an honest state, never a zero. */
export async function attempt<T>(fn: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<Loaded<T>> {
  try {
    const { data, error } = await fn();
    if (error || data === null) return failed();
    return loaded(data);
  } catch {
    return failed();
  }
}

export async function attemptCount(fn: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<Loaded<number>> {
  try {
    const { count, error } = await fn();
    if (error || count === null) return failed();
    return loaded(count);
  } catch {
    return failed();
  }
}
