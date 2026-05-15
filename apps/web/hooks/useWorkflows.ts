"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type WorkflowTrigger =
  | "candidate.stage_changed"
  | "candidate.created"
  | "job.created"
  | "job.closed"
  | "interview.scheduled"
  | "no_activity_days";

export type WorkflowActionType =
  | "send_email"
  | "send_whatsapp"
  | "add_tag"
  | "remove_tag"
  | "move_to_stage"
  | "create_task"
  | "trigger_webhook";

export interface WorkflowCondition {
  field: string;
  operator: "equals" | "not_equals" | "greater_than" | "contains";
  value: string;
}

export interface WorkflowAction {
  type: WorkflowActionType;
  config: Record<string, string>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  active: boolean;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
}

export interface CreateWorkflowData {
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

export const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  "candidate.stage_changed": "Kandidaat verplaatst naar fase",
  "candidate.created": "Nieuwe sollicitant ontvangen",
  "job.created": "Vacature aangemaakt",
  "job.closed": "Vacature gesloten",
  "interview.scheduled": "Interview gepland",
  no_activity_days: "X dagen geen activiteit",
};

export const ACTION_LABELS: Record<WorkflowActionType, string> = {
  send_email: "E-mail sturen",
  send_whatsapp: "WhatsApp sturen",
  add_tag: "Tag toevoegen",
  remove_tag: "Tag verwijderen",
  move_to_stage: "Verplaatsen naar fase",
  create_task: "Taak aanmaken",
  trigger_webhook: "Webhook triggeren",
};

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Workflow[] }>("/workflows");
      return data.data;
    },
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateWorkflowData): Promise<Workflow> => {
      const { data } = await api.post<Workflow>("/workflows", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function useToggleWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Workflow> => {
      const { data } = await api.patch<Workflow>(
        `/workflows/${id}/toggle`
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}
