"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  notes: string | null;
  type: "client" | "prospect" | "partner";
  created_at: string;
}

export interface CrmContact {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  linkedin_url: string | null;
  created_at: string;
}

export type DealStage =
  | "prospect"
  | "offerte"
  | "onderhandeling"
  | "gewonnen"
  | "verloren";

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  prospect: "Prospect",
  offerte: "Offerte",
  onderhandeling: "Onderhandeling",
  gewonnen: "Gewonnen",
  verloren: "Verloren",
};

export const DEAL_STAGES: DealStage[] = [
  "prospect",
  "offerte",
  "onderhandeling",
  "gewonnen",
  "verloren",
];

export interface CrmDeal {
  id: string;
  organization_id: string;
  organization_name?: string;
  job_id: string | null;
  job_title?: string | null;
  recruiter_id: string;
  recruiter_name?: string;
  title: string;
  stage: DealStage;
  value_eur: number;
  expected_close_date: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Organizations hooks ────────────────────────────────────────────────────

export function useOrganizations() {
  return useQuery({
    queryKey: ["crm", "organizations"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Organization[] }>(
        "/crm/organizations"
      );
      return data.data;
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (org: Partial<Organization>) => {
      const { data } = await api.post<Organization>(
        "/crm/organizations",
        org
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "organizations"] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<Organization> & { id: string }) => {
      const { data } = await api.patch<Organization>(
        `/crm/organizations/${id}`,
        updates
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "organizations"] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/crm/organizations/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "organizations"] });
      queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["crm", "deals"] });
    },
  });
}

// ─── Contacts hooks ─────────────────────────────────────────────────────────

export function useContacts(organizationId?: string) {
  return useQuery({
    queryKey: ["crm", "contacts", organizationId ?? "all"],
    queryFn: async () => {
      const { data } = await api.get<{ data: CrmContact[] }>(
        "/crm/contacts",
        {
          params: organizationId ? { organization_id: organizationId } : undefined,
        }
      );
      return data.data;
    },
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contact: Partial<CrmContact>) => {
      const { data } = await api.post<CrmContact>("/crm/contacts", contact);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/crm/contacts/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "contacts"] });
    },
  });
}

// ─── Deals hooks ────────────────────────────────────────────────────────────

export function useDeals() {
  return useQuery({
    queryKey: ["crm", "deals"],
    queryFn: async () => {
      const { data } = await api.get<{ data: CrmDeal[] }>("/crm/deals");
      return data.data;
    },
  });
}

export function useDealsPipeline() {
  return useQuery({
    queryKey: ["crm", "deals", "pipeline"],
    queryFn: async () => {
      // De API geeft `{ data: [{ stage, deals }] }` terug, maar de UI verwacht
      // een object per stage (`pipeline[stage]` = deals[]). Hier normaliseren —
      // anders is `pipeline.gewonnen`/`pipeline[stage]` undefined en breekt het
      // kanban-bord + de "verwachte omzet"-berekening.
      const { data } = await api.get<{
        data: Array<{ stage: DealStage; deals: CrmDeal[] }>;
      }>("/crm/deals/pipeline/board");
      const board: Record<DealStage, CrmDeal[]> = {
        prospect: [],
        offerte: [],
        onderhandeling: [],
        gewonnen: [],
        verloren: [],
      };
      for (const group of data?.data ?? []) {
        if (group?.stage && group.stage in board) {
          board[group.stage] = group.deals ?? [];
        }
      }
      return board;
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deal: Partial<CrmDeal>) => {
      const { data } = await api.post<CrmDeal>("/crm/deals", deal);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "deals"] });
    },
  });
}

export function useUpdateDealStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: DealStage }) => {
      const { data } = await api.patch<CrmDeal>(`/crm/deals/${id}/stage`, {
        stage,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "deals"] });
    },
  });
}
