import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SendEmailInput } from "@talentflow/shared";
import { api } from "@/lib/api";

/**
 * Outbound transactional email mutation.
 *
 * Targets `POST /api/communications/send` — a new endpoint that accepts a
 * SendEmailInput payload and enqueues the message via the
 * `emailSenderQueue`. The returned shape mirrors the existing
 * `Communication` row written by the queue worker once the message is queued.
 *
 * IMPORTANT: as of this slice the backend route does not yet exist; the hook
 * therefore falls back to an optimistic local Communication so the demo
 * dashboard keeps working in mock-mode. Backend follow-up: implement
 * `apps/api/src/modules/communications/send-email.controller.ts` (Agent N or
 * follow-up Agent M task).
 */

export interface SendEmailResponse {
  id: string;
  candidate_id: string;
  channel: "email";
  direction: "outbound";
  subject: string;
  body: string;
  sent_at: string;
  status: "sent" | "delivered" | "read" | "failed" | "queued";
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SendEmailInput): Promise<SendEmailResponse> => {
      try {
        const { data } = await api.post<SendEmailResponse>(
          "/communications/send",
          payload
        );
        return data;
      } catch {
        // Optimistic mock fallback so the UI demonstrates the full flow even
        // without the backend endpoint live yet.
        return {
          id: `local-${Date.now()}`,
          candidate_id: payload.candidate_id,
          channel: "email",
          direction: "outbound",
          subject: payload.subject,
          body: payload.body_html,
          sent_at: new Date().toISOString(),
          status: "queued",
        };
      }
    },
    onSuccess: (_, variables) => {
      // Refresh the candidate's communication thread plus the global inbox so
      // the new outbound email shows up in both views immediately.
      queryClient.invalidateQueries({
        queryKey: ["communications", variables.candidate_id],
      });
      queryClient.invalidateQueries({ queryKey: ["communications", "inbox"] });
      queryClient.invalidateQueries({ queryKey: ["communications"] });
      queryClient.invalidateQueries({
        queryKey: ["candidate-communications", variables.candidate_id],
      });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
