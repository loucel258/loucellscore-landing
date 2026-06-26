#!/usr/bin/env node
/*
 * Seed Naile Studio's services into Loucells' `services` table for the agent's
 * workspace, mapping each to its external slug so the Front Desk agent can
 * translate a Loucells service_id -> the external app's slug when calling its
 * availability API.
 *
 *   node scripts/seed-naile-services.mjs --workspace <naile_workspace_id>
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Point .env.local at the SAME Supabase project where the naile workspace lives
 * (prod). Idempotent: upserts by (workspace_id, external_slug).
 *
 * Source of truth: 02-Clientes/nailestudio/prisma/seed.ts — keep in sync if her
 * services change.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// nameEs is used (the naile agent runs in Spanish by default); price is cents.
const SERVICES = [
  { external_slug: "express-manicure", name: "Manicura express", duration_min: 25, price_cents: 2000 },
  { external_slug: "gel-manicure", name: "Manicura semipermanente", duration_min: 60, price_cents: 2500 },
  { external_slug: "product-removal", name: "Retiro de producto", duration_min: 30, price_cents: 2000 },
  { external_slug: "builder-gel", name: "Builder gel", duration_min: 75, price_cents: 3000 },
  { external_slug: "gel-x", name: "Gel-X", duration_min: 75, price_cents: 3000 },
  { external_slug: "dual-system", name: "Dual system", duration_min: 90, price_cents: 4000 },
  { external_slug: "hybrid-technique", name: "Técnica híbrida", duration_min: 105, price_cents: 4500 },
  { external_slug: "express-pedicure", name: "Pedicura express", duration_min: 30, price_cents: 2500 },
  { external_slug: "gel-pedicure", name: "Pedicura con semipermanente", duration_min: 60, price_cents: 3000 },
  { external_slug: "spa-pedicure", name: "Pedicura spa", duration_min: 75, price_cents: 4000 },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      out[k.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

function loadEnvLocal() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env.local");
  const text = fs.readFileSync(envPath, "utf-8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).trim()];
      }),
  );
}

const args = parseArgs(process.argv);
const workspaceId = args.workspace;
if (!workspaceId) {
  console.error("Usage: node scripts/seed-naile-services.mjs --workspace <naile_workspace_id>");
  process.exit(2);
}

const env = loadEnvLocal();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  let inserted = 0;
  let updated = 0;
  for (const s of SERVICES) {
    const row = {
      workspace_id: workspaceId,
      name: s.name,
      duration_min: s.duration_min,
      price_cents: s.price_cents,
      deposit_cents: 0,
      active: true,
      external_slug: s.external_slug,
    };

    const { data: existing, error: selErr } = await sb
      .from("services")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("external_slug", s.external_slug)
      .maybeSingle();
    if (selErr) {
      console.error(`select failed for ${s.external_slug}: ${selErr.message}`);
      process.exit(1);
    }

    if (existing) {
      const { error } = await sb.from("services").update(row).eq("id", existing.id);
      if (error) {
        console.error(`update failed for ${s.external_slug}: ${error.message}`);
        process.exit(1);
      }
      updated++;
    } else {
      const { error } = await sb.from("services").insert(row);
      if (error) {
        console.error(`insert failed for ${s.external_slug}: ${error.message}`);
        process.exit(1);
      }
      inserted++;
    }
    console.log(`  ✓ ${s.external_slug} → "${s.name}"`);
  }
  console.log(`\nDone. workspace=${workspaceId}: ${inserted} inserted, ${updated} updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
