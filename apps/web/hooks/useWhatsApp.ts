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
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

// ─── Integration ─────────────────────────────────────────────────────────────

export interface WhatsAppIntegrationState {
  /** Gekoppelde 360dialog-integratie van de tenant, of null. */
  integration: WhatsAppIntegration | null;
  /**
   * Kan WhatsApp in deze omgeving echt gebruikt worden? False in productie
   * zonder live 360dialog-configuratie — de UI toont dan een eerlijke
   * "WhatsApp is niet geactiveerd"-staat.
   */
  serviceActive: boolean;
}

export function useWhatsAppIntegration() {
  return useQuery({
    queryKey: ["whatsapp", "integration"],
    queryFn: async (): Promise<WhatsAppIntegrationState> => {
      // Backend-shape: { data: WhatsAppIntegration | null, service_active }
      const { data } = await api.get<{
        data: WhatsAppIntegration | null;
        service_active?: boolean;
      }>("/whatsapp/integration");
      return {
        integration: data.data ?? null,
        serviceActive: data.service_active ?? true,
      };
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
      const { data } = await api.post<{ data: WhatsAppIntegration }>(
        "/whatsapp/integration/connect",
        input
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useDisconnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.delete("/whatsapp/integration");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useWhatsAppHealthCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<WhatsAppIntegration> => {
      const { data } = await api.post<{ data: WhatsAppIntegration }>(
        "/whatsapp/integration/health-check"
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function useWhatsAppTemplates(filters: { status?: WhatsAppTemplateStatus } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "templates", filters],
    queryFn: async (): Promise<WhatsAppTemplate[]> => {
      // Backend-shape: { data: [...], next_cursor } — niet { items }.
      const { data } = await api.get<{ data: WhatsAppTemplate[] }>(
        "/whatsapp/templates",
        { params: filters }
      );
      return data.data ?? [];
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
      const { data } = await api.post<{ data: WhatsAppTemplate }>(
        "/whatsapp/templates",
        input
      );
      return data.data;
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
      const { data } = await api.patch<{ data: WhatsAppTemplate }>(
        `/whatsapp/templates/${input.id}`,
        input.patch
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/whatsapp/templates/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "templates"] }),
  });
}

export function useSubmitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<WhatsAppTemplate> => {
      const { data } = await api.post<{ data: WhatsAppTemplate }>(
        `/whatsapp/templates/${id}/submit`
      );
      return data.data;
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
      const { data } = await api.get<{ data: WhatsAppMessage[] }>(
        "/whatsapp/messages",
        { params: filters }
      );
      return data.data ?? [];
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
      const { data } = await api.post<{ data: WhatsAppMessage }>(
        "/whatsapp/messages",
        input
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp"] }),
  });
}

export function useWhatsAppConversations(filters: { candidate_id?: string } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "conversations", filters],
    queryFn: async (): Promise<WhatsAppConversation[]> => {
      const { data } = await api.get<{ data: WhatsAppConversation[] }>(
        "/whatsapp/conversations",
        { params: filters }
      );
      return data.data ?? [];
    },
  });
}

// ─── Consents ────────────────────────────────────────────────────────────────

export function useWhatsAppConsents(filters: { status?: ConsentStatus } = {}) {
  return useQuery({
    queryKey: ["whatsapp", "consents", filters],
    queryFn: async (): Promise<WhatsAppConsent[]> => {
      const { data } = await api.get<{ data: WhatsAppConsent[] }>(
        "/whatsapp/consents",
        { params: filters }
      );
      return data.data ?? [];
    },
  });
}

export function useWhatsAppConsentForCandidate(candidateId: string | undefined) {
  return useQuery({
    queryKey: ["whatsapp", "consent", candidateId ?? "none"],
    enabled: !!candidateId,
    queryFn: async (): Promise<WhatsAppConsent | null> => {
      if (!candidateId) return null;
      const { data } = await api.get<{ data: WhatsAppConsent | null }>(
        `/whatsapp/consents/${candidateId}`
      );
      return data.data ?? null;
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
    }): Promise<{ token_url: string; expires_at: string }> => {
      const { data } = await api.post<{
        data: { token_url: string; expires_at: string };
      }>("/whatsapp/consents/invite", input);
      return data.data;
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
      const { data } = await api.post<{ data: WhatsAppConsent }>(
        `/whatsapp/consents/${input.candidate_id}/withdraw`,
        { reason: input.reason }
      );
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp", "consents"] }),
  });
}

/** Public token-based opt-in flow used by the landing-page. */
export function usePublicOptInAccept() {
  return useMutation({
    mutationFn: async (token: string): Promise<{ ok: boolean }> => {
      await api.post(`/whatsapp/opt-in/${token}/accept`);
      return { ok: true };
    },
  });
}

export function usePublicOptInDecline() {
  return useMutation({
    mutationFn: async (token: string): Promise<{ ok: boolean }> => {
      await api.post(`/whatsapp/opt-in/${token}/decline`);
      return { ok: true };
    },
  });
}
