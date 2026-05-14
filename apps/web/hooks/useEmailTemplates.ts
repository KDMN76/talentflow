"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEmailTemplateInput,
  EmailTemplate,
  UpdateEmailTemplateInput,
} from "@talentflow/shared";
import { extractMergeVariables } from "@talentflow/shared";
import { api } from "@/lib/api";
import { mockEmailTemplates } from "@/lib/mockData";

/**
 * React-Query hooks for the `email_templates` resource.
 *
 * The hook surface mirrors `useCandidates`: every query/mutation falls back to
 * the in-memory `mockEmailTemplates` store when the API is unreachable, so the
 * dashboard remains fully demoable without a running backend.
 */

// ─── Mock helpers ───────────────────────────────────────────────────────────

function buildMockTemplate(input: CreateEmailTemplateInput): EmailTemplate {
  const now = new Date().toISOString();
  const detected = extractMergeVariables(
    `${input.subject}\n${input.body_html}\n${input.body_text ?? ""}`
  );
  return {
    id: `tmpl-${Date.now()}`,
    tenant_id: "tenant-1",
    name: input.name,
    subject: input.subject,
    body_html: input.body_html,
    body_text: input.body_text ?? null,
    category: input.category,
    merge_variables:
      input.merge_variables && input.merge_variables.length > 0
        ? input.merge_variables
        : detected,
    created_at: now,
    updated_at: now,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useEmailTemplates(category?: string) {
  return useQuery({
    queryKey: ["email-templates", category ?? "all"],
    queryFn: async (): Promise<EmailTemplate[]> => {
      try {
        const { data } = await api.get<{ data: EmailTemplate[] }>(
          "/email-templates",
          { params: category ? { category } : undefined }
        );
        return data.data;
      } catch {
        if (category) {
          return mockEmailTemplates.filter((t) => t.category === category);
        }
        return [...mockEmailTemplates];
      }
    },
  });
}

export function useEmailTemplate(id: string) {
  return useQuery({
    queryKey: ["email-templates", "item", id],
    queryFn: async (): Promise<EmailTemplate> => {
      try {
        const { data } = await api.get<{ data: EmailTemplate }>(
          `/email-templates/${id}`
        );
        return data.data;
      } catch {
        const found = mockEmailTemplates.find((t) => t.id === id);
        if (!found) throw new Error("Template niet gevonden");
        return found;
      }
    },
    enabled: !!id,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useCreateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateEmailTemplateInput
    ): Promise<EmailTemplate> => {
      try {
        const { data } = await api.post<{ data: EmailTemplate }>(
          "/email-templates",
          input
        );
        return data.data;
      } catch {
        const created = buildMockTemplate(input);
        mockEmailTemplates.unshift(created);
        return created;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}

export function useUpdateEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: UpdateEmailTemplateInput & { id: string }): Promise<EmailTemplate> => {
      try {
        const { data } = await api.patch<{ data: EmailTemplate }>(
          `/email-templates/${id}`,
          updates
        );
        return data.data;
      } catch {
        const idx = mockEmailTemplates.findIndex((t) => t.id === id);
        if (idx === -1) throw new Error("Template niet gevonden");
        const next: EmailTemplate = {
          ...mockEmailTemplates[idx],
          ...updates,
          merge_variables:
            updates.merge_variables && updates.merge_variables.length > 0
              ? updates.merge_variables
              : extractMergeVariables(
                  `${updates.subject ?? mockEmailTemplates[idx].subject}\n` +
                    `${updates.body_html ?? mockEmailTemplates[idx].body_html}\n` +
                    `${updates.body_text ?? mockEmailTemplates[idx].body_text ?? ""}`
                ),
          updated_at: new Date().toISOString(),
        };
        mockEmailTemplates[idx] = next;
        return next;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      queryClient.invalidateQueries({
        queryKey: ["email-templates", "item", variables.id],
      });
    },
  });
}

export function useDeleteEmailTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      try {
        await api.delete(`/email-templates/${id}`);
      } catch {
        const idx = mockEmailTemplates.findIndex((t) => t.id === id);
        if (idx !== -1) mockEmailTemplates.splice(idx, 1);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}
