"use client";

/**
 * Hands the one-time portal passcode from the New client form to the
 * client page's setup checklist. In memory only: it survives the client
 * side navigation that follows a successful create, and is gone on reload
 * or when Steven dismisses it. Never written to the URL or to storage.
 * Shaped as an external store for useSyncExternalStore.
 */

export type StashedPortal = { passcode: string; portalSlug: string };

const stash = new Map<string, StashedPortal>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function stashPasscode(engagementId: string, value: StashedPortal): void {
  stash.set(engagementId, value);
  emit();
}

export function peekPasscode(engagementId: string): StashedPortal | null {
  return stash.get(engagementId) ?? null;
}

export function clearPasscode(engagementId: string): void {
  if (stash.delete(engagementId)) emit();
}

export function subscribePasscodes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
