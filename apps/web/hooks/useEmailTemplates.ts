"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateEmailTemplateInput,
  EmailTemplate,
  UpdateEmailTemplateInput,
} from "@talentflow/shared";
import { api } from "@/lib/api";

/**
 * React-Query hooks for the `email_templates` resource.
 */

// ─── Queries ────────────────────────────────────────────────────────────────

export function useEmailTemplates(category?: string) {
  return useQuery({
    queryKey: ["email-templates", category ?? "all"],
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data } = await api.get<{ data: EmailTemplate[] }>(
        "/email-templates",
        { params: category ? { category } : undefined }
      );
      return data.data;
    },
  });
}

export function useEmailTemplate(id: string) {
  return useQuery({
    queryKey: ["email-templates", "item", id],
    queryFn: async (): Promise<EmailTemplate> => {
      const { data } = await api.get<{ data: EmailTemplate }>(
        `/email-templates/${id}`
      );
      return data.data;
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
      const { data } = await api.post<{ data: EmailTemplate }>(
        "/email-templates",
        input
      );
      return data.data;
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
      const { data } = await api.patch<{ data: EmailTemplate }>(
        `/email-templates/${id}`,
        updates
      );
      return data.data;
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
      await api.delete(`/email-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}
