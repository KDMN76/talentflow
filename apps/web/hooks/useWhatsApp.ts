"use client";

/**
 * Sprint Q4.6 — React-Query hooks for WhatsApp Business API.
 *
 * Backend contract (Agent ZZZ):
 *   Integration:  GET/POST/DELETE /api/whatsapp/integration[/connect]
 *                 POST /api/whatsapp/integration/health-check
 *   Templates:    GET/POST /api/whatsapp/templates
 *                 PATCH/DELETE /api/whatsapp/templates/:id
 *                 POST /api/whatsapp/templates/:id/submit
 *                 POST /api/whatsapp/templates/:id/sync
 *   Messages:     GET/POST /api/whatsapp/messages
 *                 GET /api/whatsapp/conversations
 *   Consents:     GET /api/whatsapp/consents
 *                 GET /api/whatsapp/consents/:candidate_id
 *                 POST /api/whatsapp/consents/invite
 *                 POST /api/whatsapp/consents/:candidate_id/withdraw
 *
 * Mock-mode: a submitted template auto-approves 4s after submit.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockWhatsAppIntegration,
  mockWhatsAppTemplates,
  mockWhatsAppMessages,
  mockWhatsAppConversations,
  mockWhatsAppConsents,
} from "@/lib/mockData";
import type {
  ConsentStatus,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppIntegration,
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppTemplate,
  WhatsAppTemplateStatus,
} from "@/lib/types/whatsapp";

export type {
  ConsentStatus,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppIntegration,
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppTemplate,
  WhatsAppTemplateStatus,
} from "@/lib/types/whatsapp";

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockIntegration: WhatsAppIntegration = { ...mockWhatsAppIntegration };
let mockTemplates: WhatsAppTemplate[] = [...mockWhatsAppTemplates];
let mockMessages: WhatsAppMessage[] = [...mockWhatsAppMessages];
let mockConversations: WhatsAppConversation[] = [...mockWhatsAppConversations];
let mockConsents: WhatsAppConsent[] = [...mockWhatsAppConsents];

function syncTemplates() {
  mockWhatsAppTemplates.length = 0;
  mockWhatsAppTemplates.push(...mockTemplates);
}
function syncMessages() {
  mockWhatsAppMessages.length = 0;
  mockWhatsAppMessages.push(...mockMessages);
}
function syncConsents() {
  mockWhatsAppConsents.length = 0;
  mockWhatsAppConsents.push(...mockConsents);
}

/** Per-template submit timestamp — drives the 4s auto-approve. */
const templateSubmitTimes: Record<string, number> = {};

function progressTemplates() {
  const now = Date.now();
  for (const t of mockTemplates) {
    if (t.status === "submitted") {
      const start = templateSubmitTimes[t.id];
      if (start && now - start >= 4_000) {
        t.status = "approved";
        t.approved_at = new Date(now).toISOString();
      }
    }
  }
}

// ─── Integration ─────────────────────────────────────────────────────────────

export function useWhatsAppIntegration() {
  return useQuery({
    queryKey: ["whatsapp", "integration"],
    queryFn: async (): Promise<WhatsAppIntegration> => {
      try {
        const { data } = await api.get<WhatsAppIntegration>("/whatsapp/integration");
        return data;
      } catch {
        return { ...mockIntegration };
      }
    },
  });
}

export function useConnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      phone_number: string;
      api_key: string;
      waba_id: string;
      display_name?: string;
    }): Promise<WhatsAppIntegration> => {
      try {
        const { data } = await api.post<WhatsAppIntegration>(
          "/whatsapp/integration/connect",
          input
        );
        return data;
      } catch {
        mockIntegration = {
          ...mockIntegration,
          status: "connected",
          phone_number: input.phone_number,
          waba_id: input.waba_id,
          display_name: input.display_name ?? mockIntegration.display_name,
          quality_rating: "green",
          messaging_limit: "1K / 24h",
          connected_at: new Date().toISOString(),
          last_error: null,
        };
        return { ...mockIntegration };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useDisconnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        await api.delete("/whatsapp/integration");
      } catch {
        mockIntegration = {
          ...mockIntegration,
          status: "disconnected",
          phone_number: "",
          waba_id: null,
          connected_at: null,
        };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useWhatsAppHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<WhatsAppIntegration> => {
      try {
        const { data } = await api.post<WhatsAppIntegration>(
          "/whatsapp/integration/health-check"
        );
        return data;
      } catch {
        mockIntegration = {
          ...mockIntegration,
          last_health_check_at: new Date().toISOString(),
          last_error: null,
        };
        return { ...mockIntegration };
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function useWhatsAppTemplates(filters: { status?: WhatsAppTemplateStatus } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "templates", filters],
    queryFn: async (): Promise<WhatsAppTemplate[]> => {
      try {
        const { data } = await api.get<{ items: WhatsAppTemplate[] }>(
          "/whatsapp/templates",
          { params: filters }
        );
        return data.items;
      } catch {
        progressTemplates();
        return mockTemplates
          .filter((t) => !filters.status || t.status === filters.status)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      }
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.some((t) => t.status === "submitted")) {
        return 1_500;
      }
      return false;
    },
  });
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: WhatsAppTemplate["category"];
  header: WhatsAppTemplate["header"];
  body: string;
  footer: string | null;
  buttons: WhatsAppTemplate["buttons"];
  example_variables: string[];
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<WhatsAppTemplate> => {
      try {
        const { data } = await api.post<WhatsAppTemplate>(
          "/whatsapp/templates",
          input
        );
        return data;
      } catch {
        const now = new Date().toISOString();
        const created: WhatsAppTemplate = {
          id: `wa-tpl-${Date.now()}`,
          status: "draft",
          rejection_reason: null,
          submitted_at: null,
          approved_at: null,
          created_at: now,
          updated_at: now,
          ...input,
        };
        mockTemplates = [created, ...mockTemplates];
        syncTemplates();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<CreateTemplateInput>;
    }): Promise<WhatsAppTemplate> => {
      try {
        const { data } = await api.patch<WhatsAppTemplate>(
          `/whatsapp/templates/${input.id}`,
          input.patch
        );
        return data;
      } catch {
        const idx = mockTemplates.findIndex((t) => t.id === input.id);
        if (idx === -1) throw new Error("Template niet gevonden");
        mockTemplates[idx] = {
          ...mockTemplates[idx],
          ...input.patch,
          updated_at: new Date().toISOString(),
        };
        syncTemplates();
        return mockTemplates[idx];
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.delete(`/whatsapp/templates/${id}`);
      } catch {
        mockTemplates = mockTemplates.filter((t) => t.id !== id);
        syncTemplates();
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

export function useSubmitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<WhatsAppTemplate> => {
      try {
        const { data } = await api.post<WhatsAppTemplate>(
          `/whatsapp/templates/${id}/submit`
        );
        return data;
      } catch {
        const idx = mockTemplates.findIndex((t) => t.id === id);
        if (idx === -1) throw new Error("Template niet gevonden");
        const now = new Date().toISOString();
        mockTemplates[idx] = {
          ...mockTemplates[idx],
          status: "submitted",
          submitted_at: now,
          rejection_reason: null,
          updated_at: now,
        };
        templateSubmitTimes[id] = Date.now();
        syncTemplates();
        return mockTemplates[idx];
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

// ─── Messages & conversations ────────────────────────────────────────────────

export interface WhatsAppMessageFilters {
  candidate_id?: string;
  direction?: "inbound" | "outbound";
  status?: WhatsAppMessageStatus;
}

export function useWhatsAppMessages(filters: WhatsAppMessageFilters = {}) {
  return useQuery({
    queryKey: ["whatsapp", "messages", filters],
    queryFn: async (): Promise<WhatsAppMessage[]> => {
      try {
        const { data } = await api.get<{ items: WhatsAppMessage[] }>(
          "/whatsapp/messages",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockMessages
          .filter((m) => {
            if (filters.candidate_id && m.candidate_id !== filters.candidate_id)
              return false;
            if (filters.direction && m.direction !== filters.direction)
              return false;
            if (filters.status && m.status !== filters.status) return false;
            return true;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
    },
  });
}

export function useSendWhatsAppMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      candidate_id: string;
      kind: WhatsAppMessageType;
      body?: string;
      template_id?: string;
      variables?: Record<string, string>;
      media_url?: string;
      media_type?: string;
    }): Promise<WhatsAppMessage> => {
      try {
        const { data } = await api.post<WhatsAppMessage>(
          "/whatsapp/messages",
          input
        );
        return data;
      } catch {
        const now = new Date().toISOString();
        const created: WhatsAppMessage = {
          id: `wa-msg-${Date.now()}`,
          candidate_id: input.candidate_id,
          conversation_id: null,
          direction: "outbound",
          message_type: input.kind,
          template_id: input.template_id ?? null,
          body_text: input.body ?? null,
          media_url: input.media_url ?? null,
          media_mime: input.media_type ?? null,
          status: "sent",
          external_id: null,
          sent_at: now,
          delivered_at: null,
          read_at: null,
          error_message: null,
          created_at: now,
        };
        mockMessages = [created, ...mockMessages];
        syncMessages();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useWhatsAppConversations(filters: { candidate_id?: string } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "conversations", filters],
    queryFn: async (): Promise<WhatsAppConversation[]> => {
      try {
        const { data } = await api.get<{ items: WhatsAppConversation[] }>(
          "/whatsapp/conversations",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockConversations.filter(
          (c) => !filters.candidate_id || c.candidate_id === filters.candidate_id
        );
      }
    },
  });
}

// ─── Consents ────────────────────────────────────────────────────────────────

export function useWhatsAppConsents(filters: { status?: ConsentStatus } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "consents", filters],
    queryFn: async (): Promise<WhatsAppConsent[]> => {
      try {
        const { data } = await api.get<{ items: WhatsAppConsent[] }>(
          "/whatsapp/consents",
          { params: filters }
        );
        return data.items;
      } catch {
        return mockConsents.filter(
          (c) => !filters.status || c.status === filters.status
        );
      }
    },
  });
}

export function useWhatsAppConsentForCandidate(candidateId: string | undefined) {
  return useQuery({
    queryKey: ["whatsapp", "consent", candidateId ?? "none"],
    enabled: !!candidateId,
    queryFn: async (): Promise<WhatsAppConsent | null> => {
      if (!candidateId) return null;
      try {
        const { data } = await api.get<WhatsAppConsent>(
          `/whatsapp/consents/${candidateId}`
        );
        return data;
      } catch {
        return mockConsents.find((c) => c.candidate_id === candidateId) ?? null;
      }
    },
  });
}

export function useInviteWhatsAppConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      candidate_id: string;
      phone_number: string;
      candidate_name?: string;
    }): Promise<WhatsAppConsent> => {
      try {
        const { data } = await api.post<WhatsAppConsent>(
          "/whatsapp/consents/invite",
          input
        );
        return data;
      } catch {
        const idx = mockConsents.findIndex(
          (c) => c.candidate_id === input.candidate_id
        );
        if (idx >= 0) {
          mockConsents[idx] = {
            ...mockConsents[idx],
            status: "pending",
            phone_number: input.phone_number,
            opt_in_source: "whatsapp_template",
          };
          syncConsents();
          return mockConsents[idx];
        }
        const created: WhatsAppConsent = {
          id: `wa-consent-${Date.now()}`,
          candidate_id: input.candidate_id,
          candidate_name: input.candidate_name,
          phone_number: input.phone_number,
          status: "pending",
          opt_in_source: "whatsapp_template",
          granted_at: null,
          withdrawn_at: null,
          withdrawal_reason: null,
        };
        mockConsents = [created, ...mockConsents];
        syncConsents();
        return created;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "consents"] }),
  });
}

export function useWithdrawWhatsAppConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      candidate_id: string;
      reason: string;
    }): Promise<WhatsAppConsent> => {
      try {
        const { data } = await api.post<WhatsAppConsent>(
          `/whatsapp/consents/${input.candidate_id}/withdraw`,
          { reason: input.reason }
        );
        return data;
      } catch {
        const idx = mockConsents.findIndex(
          (c) => c.candidate_id === input.candidate_id
        );
        if (idx === -1) throw new Error("Consent niet gevonden");
        mockConsents[idx] = {
          ...mockConsents[idx],
          status: "withdrawn",
          withdrawn_at: new Date().toISOString(),
          withdrawal_reason: input.reason,
        };
        syncConsents();
        return mockConsents[idx];
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "consents"] }),
  });
}

/** Public token-based opt-in flow used by the landing-page. */
export function usePublicOptInAccept() {
  return useMutation({
    mutationFn: async (token: string): Promise<{ ok: boolean }> => {
      try {
        await api.post(`/whatsapp/opt-in/${token}/accept`);
        return { ok: true };
      } catch {
        return { ok: true };
      }
    },
  });
}

export function usePublicOptInDecline() {
  return useMutation({
    mutationFn: async (token: string): Promise<{ ok: boolean }> => {
      try {
        await api.post(`/whatsapp/opt-in/${token}/decline`);
        return { ok: true };
      } catch {
        return { ok: true };
      }
    },
  });
}
