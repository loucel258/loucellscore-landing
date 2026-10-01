/**
 * Recognize "this schema piece isn't deployed yet" errors from PostgREST so
 * the portal can ship ahead of a migration and degrade instead of crashing.
 *
 *   42P01     Postgres: relation does not exist
 *   PGRST205  PostgREST: table not found in the schema cache
 *   42703     Postgres: column does not exist (e.g. in a select list)
 *   PGRST204  PostgREST: column not found in the schema cache
 *
 * Pure: no imports, safe in tests.
 */

type DbError = { code?: string | null } | null | undefined;

export function isMissingTable(err: DbError): boolean {
  const code = err?.code ?? "";
  return code === "42P01" || code === "PGRST205";
}

export function isMissingColumn(err: DbError): boolean {
  const code = err?.code ?? "";
  return code === "42703" || code === "PGRST204";
}
