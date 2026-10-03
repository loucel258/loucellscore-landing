import { handleVoiceAfter } from "@/lib/agent-runtime/channels/voice-twilio";

/** Voice channel route. Thin wrapper: the logic lives in src/lib/agent-runtime/channels/voice-twilio.ts. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A call turn is short (20 s deadline); streaming keeps the connection open while it runs.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleVoiceAfter(req, slug);
}
