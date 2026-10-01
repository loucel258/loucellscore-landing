/**
 * Case-insensitive exact email matching over PostgREST.
 *
 * `leads.email` is stored as the visitor typed it ("Ana@Mail.com") while
 * portal URLs carry it lowercased, so `.eq()` misses. `.ilike()` is
 * case-insensitive but treats `%`, `_` (and PostgREST's `*` alias) as
 * wildcards, so the pattern escapes `\`, `%`, `_`, turns `*` into a
 * single-character `_` (PostgREST can't express a literal `*`), and
 * callers re-check rows with sameEmail() to drop any widened match.
 */

export function ilikeExactPattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
