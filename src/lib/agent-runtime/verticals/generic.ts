import type { VerticalProfile } from "./index";

/** Neutral default for any appointment-based local business. */
export const generic: VerticalProfile = {
  id: "generic",
  kind: "a local business",
  scope: (name) =>
    `Only discuss ${name}: its services, appointments, hours, location, and policies (from the knowledge base).`,
  intentSubject: "a local business's front-desk assistant",
  intentHints: [],
};
