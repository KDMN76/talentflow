"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  MailboxIntegration,
  MailboxProvider,
} from "@/lib/mockData";

/**
 * React-Query hooks for mailbox integrations (Gmail / Outlook OAuth).
 *
 * Backend contract (Agent SS):
 *   GET    /api/integrations/mailbox                          → MailboxIntegration[]
 *   GET    /api/integrations/mailbox/oauth/:provider/start    → { url }
 *   DELETE /api/integrations/mailbox/:id                      → 204
 */

export type { MailboxIntegration, MailboxProvider } from "@/lib/mockData";

// ─── Queries ────────────────────────────────────────────────────────────────

export function useMailboxIntegrations() {
  return useQuery({
    queryKey: ["mailbox-integrations"],
    queryFn: async (): Promise<MailboxIntegration[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug (anders crasht
      // `.reduce` op het wrapper-object → witte pagina /settings/integrations).
      const { data } = await api.get<{ data: MailboxIntegration[] }>(
        "/integrations/mailbox"
      );
      return data.data ?? [];
    },
  });
}

/**
 * Config-status van de OAuth-providers: welke providers hebben server-side
 * client-credentials (client-id/secret) ingericht. Bevat GEEN secrets — enkel
 * booleans. De UI gebruikt dit om "Verbind Gmail/Outlook" te disablen zolang
 * de koppeling nog niet is ingericht (i.p.v. naar een kapotte OAuth-URL te
 * navigeren). `outlook` dekt ook Microsoft 365 (zelfde Microsoft-OAuth).
 */
export interface MailboxProviderConfig {
  providers: Partial<Record<MailboxProvider, { configured: boolean }>>;
  smtp: { available: boolean };
}

export function useMailboxProviderConfig() {
  return useQuery({
    queryKey: ["mailbox-provider-config"],
    queryFn: async (): Promise<MailboxProviderConfig> => {
      const { data } = await api.get<{ data: MailboxProviderConfig }>(
        "/integrations/mailbox/providers"
      );
      return data.data;
    },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

interface OAuthStartResponse {
  url: string;
}

/**
 * Kicks off an OAuth handshake. The mutation returns `{ url }` — the caller
 * is expected to redirect via `window.location.href` because the OAuth flow
 * leaves the SPA entirely (Google/Microsoft → callback → /settings/integrations).
 */
export function useStartOAuth() {
  return useMutation({
    mutationFn: async (
      provider: MailboxProvider
    ): Promise<OAuthStartResponse> => {
      const { data } = await api.get<OAuthStartResponse>(
        `/integrations/mailbox/oauth/${provider}/start`
      );
      return data;
    },
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/integrations/mailbox/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-integrations"] });
    },
  });
}
