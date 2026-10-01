/**
 * PostgREST returns at most 1000 rows per request (Supabase's default
 * max-rows), whatever .limit() asks for, and says nothing when it cuts.
 * Report queries page through with .range() instead, so a busy client's
 * numbers are never silently truncated.
 */

type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };

export const PAGE_SIZE = 1000;

/**
 * Fetch every row of an ordered query. `page(from, to)` must apply a stable
 * order and .range(from, to). Stops at `maxRows` (a safety cap well above
 * current volume) and reports whether it hit it.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  maxRows = 50_000,
): Promise<{ rows: T[]; error: PageResult<T>["error"]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error, truncated: false };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

/** Split a list for `.in()` filters so URLs stay short. */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
