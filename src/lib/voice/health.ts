/**
 * Is the voice gateway up? Checked by the 15-minute health cron: when it is
 * down, calls fall back to "someone will call you back" (voice/after), so
 * nobody hears dead air, but the owner should know within minutes.
 */

export type GatewayHealth = { configured: false } | { configured: true; ok: boolean; detail: string };

/** https://host/health from VOICE_GATEWAY_URL ("host", "https://host" or "wss://host"). */
export function gatewayHealthUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().replace(/^(?:wss?|https?):\/\//i, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{2,5})?$/i.test(host)) return null;
  return `https://${host}/health`;
}

export async function checkVoiceGateway(
  raw: string | undefined = process.env.VOICE_GATEWAY_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayHealth> {
  const url = gatewayHealthUrl(raw);
  if (!url) return { configured: false };
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    return { configured: true, ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { configured: true, ok: false, detail: e instanceof Error ? e.name : "error" };
  }
}
