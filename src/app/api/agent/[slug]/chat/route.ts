import { handleWebChat, handleWebPreflight } from "@/lib/agent-runtime/channels/web";

/**
 * Multi-tenant web chat (public/agent.js widget + the marketing site's own
 * chat, slug loucels-landing). Thin wrapper: the pipeline lives in
 * src/lib/agent-runtime (channels/web.ts → runTurn).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleWebPreflight(req, slug);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleWebChat(req, slug);
}
