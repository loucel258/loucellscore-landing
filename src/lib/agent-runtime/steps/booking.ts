import "server-only";
import type { TurnContext } from "../context";
import { contactOf } from "../types";

/**
 * SMS: services for the prompt + the booking backend, resolved once per turn
 * and bound to this workspace + contact (ctx.booking). Used before the model
 * loop and before running a customer-confirmed action (steps/confirm.ts).
 */
export async function prepareBooking(ctx: TurnContext): Promise<void> {
  const contact = contactOf(ctx.inbound.conv);
  if (!contact || ctx.booking) return;
  const { config } = ctx;
  if (!ctx.services) ctx.services = (await ctx.deps.store?.listServices(config.workspaceId)) ?? [];
  // external_unavailable is fail-closed: booking tools answer "unavailable",
  // never local Postgres.
  const backend = await ctx.deps.resolveBookingBackend(config.workspaceId, config.integrationsRaw);
  if (backend.mode === "external_unavailable") {
    console.warn(`[front-desk] ${config.slug}: external booking backend unavailable (${backend.reason})`);
  }
  ctx.booking = {
    workspaceId: config.workspaceId,
    contactId: contact.contactId,
    calendarId: config.integrations.calendar.calendar_id,
    timezone: config.timezone,
    businessHours: config.businessHours,
    agentSlug: config.slug,
    externalBackend: backend.mode === "external" ? backend.backend : null,
    bookingUnavailable: backend.mode === "external_unavailable",
    bookingLinkOnly: backend.mode === "link",
    bookingLinkUrl: backend.mode === "link" ? backend.linkUrl : config.integrations.booking.link_url,
    contactPhone: contact.phone || undefined,
  };
}
