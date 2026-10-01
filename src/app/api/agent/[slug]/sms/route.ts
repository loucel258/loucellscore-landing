import { handleTwilioInbound } from "@/lib/agent-runtime/channels/sms";

/**
 * Inbound SMS webhook for a Front Desk agent. Thin wrapper: the adapter
 * verifies the Twilio signature, answers empty TwiML right away and runs the
 * turn in after() (src/lib/agent-runtime/channels/sms.ts → runTurn).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Budget for the after() turn (its own deadline is 45s: model calls + escalation + reply).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleTwilioInbound(req, slug);
}
