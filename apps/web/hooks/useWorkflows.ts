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

const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: "wf-1",
    name: "Welkomstmail bij nieuwe sollicitatie",
    description:
      "Stuur automatisch een bevestigingsmail wanneer iemand solliciteert.",
    trigger: "candidate.created",
    conditions: [],
    actions: [
      {
        type: "send_email",
        config: {
          template: "welkom",
          subject: "Bedankt voor je sollicitatie!",
        },
      },
    ],
    active: true,
    run_count: 47,
    last_run_at: "2024-01-25T11:00:00Z",
    created_at: "2024-01-01T10:00:00Z",
  },
  {
    id: "wf-2",
    name: "WhatsApp herinnering bij interview",
    description: "Stuur een WhatsApp-bericht 24 uur voor een gepland interview.",
    trigger: "interview.scheduled",
    conditions: [],
    actions: [
      {
        type: "send_whatsapp",
        config: {
          message: "Herinnering: morgen om {{time}} heb je een interview.",
        },
      },
    ],
    active: true,
    run_count: 12,
    last_run_at: "2024-01-24T09:00:00Z",
    created_at: "2024-01-05T10:00:00Z",
  },
  {
    id: "wf-3",
    name: "Inactiviteitsmelding na 14 dagen",
    description:
      "Wijs recruiter op kandidaten die 14 dagen geen activiteit hebben.",
    trigger: "no_activity_days",
    conditions: [{ field: "days", operator: "greater_than", value: "14" }],
    actions: [
      {
        type: "create_task",
        config: { title: "Opvolgen: kandidaat zonder activiteit" },
      },
    ],
    active: false,
    run_count: 3,
    last_run_at: "2024-01-10T08:00:00Z",
    created_at: "2024-01-08T10:00:00Z",
  },
  {
    id: "wf-4",
    name: "Tag toevoegen bij aanbieding",
    description:
      "Voeg de tag 'offerte-fase' toe wanneer een kandidaat naar Aanbieding wordt verplaatst.",
    trigger: "candidate.stage_changed",
    conditions: [
      { field: "stage_name", operator: "equals", value: "Aanbieding" },
    ],
    actions: [{ type: "add_tag", config: { tag: "offerte-fase" } }],
    active: true,
    run_count: 8,
    last_run_at: "2024-01-23T15:00:00Z",
    created_at: "2024-01-12T10:00:00Z",
  },
];

// In-memory mutable store for mock data
let mockWorkflows = [...MOCK_WORKFLOWS];

export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: Workflow[] }>("/api/workflows");
        return data.data;
      } catch {
        return [...mockWorkflows];
      }
    },
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateWorkflowData): Promise<Workflow> => {
      try {
        const { data } = await api.post<Workflow>("/api/workflows", payload);
        return data;
      } catch {
        const newWorkflow: Workflow = {
          id: `wf-${Date.now()}`,
          name: payload.name,
          description: payload.description,
          trigger: payload.trigger,
          conditions: payload.conditions,
          actions: payload.actions,
          active: true,
          run_count: 0,
          last_run_at: null,
          created_at: new Date().toISOString(),
        };
        mockWorkflows.unshift(newWorkflow);
        return newWorkflow;
      }
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
      try {
        const { data } = await api.patch<Workflow>(
          `/api/workflows/${id}/toggle`
        );
        return data;
      } catch {
        // Optimistic toggle in cache
        const idx = mockWorkflows.findIndex((w) => w.id === id);
        if (idx !== -1) {
          mockWorkflows[idx] = {
            ...mockWorkflows[idx],
            active: !mockWorkflows[idx].active,
          };
          queryClient.setQueryData<Workflow[]>(["workflows"], (old) =>
            old
              ? old.map((w) => (w.id === id ? { ...w, active: !w.active } : w))
              : []
          );
          return mockWorkflows[idx];
        }
        throw new Error("Workflow niet gevonden");
      }
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
      try {
        await api.delete(`/api/workflows/${id}`);
      } catch {
        mockWorkflows = mockWorkflows.filter((w) => w.id !== id);
        queryClient.setQueryData<Workflow[]>(["workflows"], (old) =>
          old ? old.filter((w) => w.id !== id) : []
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    },
  });
}
