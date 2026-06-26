#!/usr/bin/env node
/*
 * Set a Front Desk agent's knowledge base (integrations.kb) from a markdown file.
 * The orchestrator injects this into the system prompt as the grounding FAQ/info.
 *
 *   node scripts/set-agent-kb.mjs --workspace <workspace_id> --file scripts/kb-naile.md
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Merges kb into the existing integrations (preserves calendar/reminders/locale).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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
const file = args.file;
if (!workspaceId || !file) {
  console.error("Usage: node scripts/set-agent-kb.mjs --workspace <id> --file <path.md>");
  process.exit(2);
}

const kb = fs.readFileSync(path.resolve(file), "utf-8").trim();
if (!kb) {
  console.error("KB file is empty.");
  process.exit(2);
}

const env = loadEnvLocal();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: agent, error } = await sb
    .from("client_agents")
    .select("id, slug, integrations")
    .eq("workspace_id", workspaceId)
    .eq("agent_type", "ai_front_desk")
    .maybeSingle();
  if (error) {
    console.error("lookup failed:", error.message);
    process.exit(1);
  }
  if (!agent) {
    console.error(`No ai_front_desk agent found for workspace ${workspaceId}`);
    process.exit(1);
  }

  const integrations = { ...(agent.integrations ?? {}), kb };
  const { error: upErr } = await sb.from("client_agents").update({ integrations }).eq("id", agent.id);
  if (upErr) {
    console.error("update failed:", upErr.message);
    process.exit(1);
  }
  console.log(`✓ KB set for agent "${agent.slug}" (${kb.length} chars).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
