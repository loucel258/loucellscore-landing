/**
 * Recognize "schema not there yet" errors so admin code can degrade when a
 * migration has not been applied. Postgres codes come through PostgREST
 * unchanged for SQL errors; PGRST2xx are PostgREST's own schema-cache
 * misses (a column in an insert/update payload, or a whole table).
 */

type MaybePgError = { code?: string | null; message?: string | null } | null | undefined;

/** Undefined column (42703) or column missing from PostgREST's cache (PGRST204). */
export function isMissingColumnError(err: MaybePgError): boolean {
  return !!err && (err.code === "42703" || err.code === "PGRST204");
}

/** Undefined table (42P01) or table missing from PostgREST's cache (PGRST205). */
export function isMissingTableError(err: MaybePgError): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205");
}

export function isUniqueViolation(err: MaybePgError): boolean {
  return !!err && err.code === "23505";
}
