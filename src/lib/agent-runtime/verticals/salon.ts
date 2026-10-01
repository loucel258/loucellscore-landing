import type { VerticalProfile } from "./index";

/** Nail salon (and similar beauty services). Moved from the SMS orchestrator + intent classifier. */
export const salon: VerticalProfile = {
  id: "salon",
  kind: "a nail salon",
  scope: (name) =>
    `Only discuss ${name}: its services, appointments, hours, location, policies, and basic nail-care questions about the services it offers (from the knowledge base).`,
  intentSubject: "a nail salon's front-desk assistant",
  intentHints: [
    'Service words like "gel", "acrílico", "acrylic", "manicure", "pedicure", "uñas" or "nails" are on topic: the customer is asking about a service (service_info) or wants to book (book).',
  ],
};
