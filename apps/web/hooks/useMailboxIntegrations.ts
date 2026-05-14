"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockMailboxIntegrations,
  type MailboxIntegration,
  type MailboxProvider,
} from "@/lib/mockData";

/**
 * React-Query hooks for mailbox integrations (Gmail / Outlook OAuth).
 *
 * Backend contract (Agent SS):
 *   GET    /api/integrations/mailbox                          → MailboxIntegration[]
 *   GET    /api/integrations/mailbox/oauth/:provider/start    → { url }
 *   DELETE /api/integrations/mailbox/:id                      → 204
 *
 * Each call falls back to in-memory mock state so the UI keeps demoable
 * when the API is unreachable. Mock state mutates a module-level array so
 * disconnects + reconnects appear consistent within a session.
 */

export type { MailboxIntegration, MailboxProvider } from "@/lib/mockData";

// In-memory copy that we mutate from the mock fallbacks so disconnects stick
// across re-fetches within the same browser session.
let mockState: MailboxIntegration[] = [...mockMailboxIntegrations];

function syncMockToSource() {
  // Keep the exported mock array in sync so other modules (e.g. campaigns
  // page) that read from it directly stay consistent.
  mockMailboxIntegrations.length = 0;
  mockMailboxIntegrations.push(...mockState);
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useMailboxIntegrations() {
  return useQuery({
    queryKey: ["mailbox-integrations"],
    queryFn: async (): Promise<MailboxIntegration[]> => {
      try {
        const { data } = await api.get<MailboxIntegration[]>(
          "/integrations/mailbox"
        );
        return data;
      } catch {
        return [...mockState];
      }
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
 *
 * Mock fallback simulates a "pending" Gmail or Outlook account being added
 * locally so the UI gives feedback without a backend.
 */
export function useStartOAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      provider: MailboxProvider
    ): Promise<OAuthStartResponse & { mock?: boolean }> => {
      try {
        const { data } = await api.get<OAuthStartResponse>(
          `/integrations/mailbox/oauth/${provider}/start`
        );
        return data;
      } catch {
        // Add a mock integration so the user sees the result of the flow even
        // without a backend running.
        const exists = mockState.some(
          (m) => m.provider === provider && m.account_email.includes("demo")
        );
        if (!exists) {
          mockState = [
            ...mockState,
            {
              id: `mbx-mock-${Date.now()}`,
              tenant_id: "tenant-1",
              user_id: "user-1",
              provider,
              account_email:
                provider === "gmail"
                  ? "demo.recruiter@gmail.com"
                  : "demo.recruiter@outlook.com",
              account_name: "Demo Recruiter",
              last_sync_at: new Date().toISOString(),
              emails_synced_24h: 0,
              active: true,
              scopes:
                provider === "gmail"
                  ? [
                      "https://www.googleapis.com/auth/gmail.send",
                      "https://www.googleapis.com/auth/gmail.readonly",
                    ]
                  : ["Mail.Send", "Mail.Read"],
              created_at: new Date().toISOString(),
            },
          ];
          syncMockToSource();
          queryClient.invalidateQueries({ queryKey: ["mailbox-integrations"] });
        }
        return {
          url: `${window.location.origin}/settings/integrations?status=success&provider=${provider}&mock=1`,
          mock: true,
        };
      }
    },
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.delete(`/integrations/mailbox/${id}`);
      } catch {
        mockState = mockState.filter((m) => m.id !== id);
        syncMockToSource();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-integrations"] });
    },
  });
}
