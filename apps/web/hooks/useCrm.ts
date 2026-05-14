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

// ─── Mock data (rich Dutch examples) ────────────────────────────────────────

const MOCK_ORGANIZATIONS: Organization[] = [
  {
    id: "org-1",
    name: "ING Bank N.V.",
    industry: "Financiële dienstverlening",
    website: "https://www.ing.nl",
    notes:
      "Strategische klant. Werven jaarlijks 30+ engineers en data scientists. Contact loopt via Talent Acquisition.",
    type: "client",
    created_at: "2024-01-08T09:00:00Z",
  },
  {
    id: "org-2",
    name: "Bol.com",
    industry: "E-commerce",
    website: "https://www.bol.com",
    notes:
      "Eerste gesprek geweest. Geïnteresseerd in pilot voor product-team. Beslissing verwacht in Q2.",
    type: "prospect",
    created_at: "2024-02-12T11:30:00Z",
  },
  {
    id: "org-3",
    name: "Adyen",
    industry: "Fintech / Payments",
    website: "https://www.adyen.com",
    notes:
      "Snelgroeiende klant. Hoge eisen aan kandidaten. Werkt met meerdere bureaus, wij staan in top 3.",
    type: "client",
    created_at: "2023-11-20T14:00:00Z",
  },
  {
    id: "org-4",
    name: "Tech Talent Network",
    industry: "Recruitment partner",
    website: "https://techtalentnetwork.nl",
    notes:
      "Partner voor uitwisseling van pipeline-kandidaten. Splitfee 50/50 op succesvolle plaatsingen.",
    type: "partner",
    created_at: "2024-03-05T08:15:00Z",
  },
];

const MOCK_CONTACTS: CrmContact[] = [
  {
    id: "ctc-1",
    organization_id: "org-1",
    name: "Marieke de Vries",
    email: "marieke.devries@ing.nl",
    phone: "+31 20 555 1234",
    role: "Head of Talent Acquisition",
    linkedin_url: "https://linkedin.com/in/marieke-de-vries",
    created_at: "2024-01-09T09:30:00Z",
  },
  {
    id: "ctc-2",
    organization_id: "org-1",
    name: "Pieter Hoekstra",
    email: "pieter.hoekstra@ing.nl",
    phone: "+31 20 555 5678",
    role: "Engineering Manager",
    linkedin_url: null,
    created_at: "2024-01-15T10:00:00Z",
  },
  {
    id: "ctc-3",
    organization_id: "org-2",
    name: "Sanne Bakker",
    email: "s.bakker@bol.com",
    phone: "+31 30 222 1010",
    role: "VP People",
    linkedin_url: "https://linkedin.com/in/sannebakker",
    created_at: "2024-02-13T13:00:00Z",
  },
  {
    id: "ctc-4",
    organization_id: "org-3",
    name: "Daan van Leeuwen",
    email: "daan.vanleeuwen@adyen.com",
    phone: "+31 20 240 1000",
    role: "Senior Recruiter",
    linkedin_url: "https://linkedin.com/in/daanvanleeuwen",
    created_at: "2023-11-21T11:45:00Z",
  },
  {
    id: "ctc-5",
    organization_id: "org-4",
    name: "Yasmin Karimi",
    email: "yasmin@techtalentnetwork.nl",
    phone: "+31 6 22334455",
    role: "Managing Partner",
    linkedin_url: "https://linkedin.com/in/yasminkarimi",
    created_at: "2024-03-06T09:00:00Z",
  },
];

const thisMonth = (() => {
  const d = new Date();
  d.setDate(15);
  return d.toISOString();
})();

const nextMonth = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(10);
  return d.toISOString();
})();

const MOCK_DEALS: CrmDeal[] = [
  {
    id: "deal-1",
    organization_id: "org-1",
    organization_name: "ING Bank N.V.",
    job_id: "job-1",
    job_title: "Senior Frontend Developer",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    title: "Plaatsing Senior Frontend ING",
    stage: "onderhandeling",
    value_eur: 28500,
    expected_close_date: thisMonth,
    notes:
      "Eindgesprek ingepland. Kandidaat Sophie van den Berg is favoriet. Tarief onderhandeling loopt.",
    created_at: "2024-02-01T10:00:00Z",
  },
  {
    id: "deal-2",
    organization_id: "org-3",
    organization_name: "Adyen",
    job_id: null,
    job_title: null,
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    title: "Retainer Q2 — 3 plaatsingen",
    stage: "offerte",
    value_eur: 75000,
    expected_close_date: nextMonth,
    notes:
      "Offerte verstuurd voor exclusief retainer-contract. Wachten op interne goedkeuring CFO.",
    created_at: "2024-03-10T14:00:00Z",
  },
  {
    id: "deal-3",
    organization_id: "org-2",
    organization_name: "Bol.com",
    job_id: "job-2",
    job_title: "Product Manager",
    recruiter_id: "user-1",
    recruiter_name: "Emma Bakker",
    title: "Pilot PM zoekopdracht",
    stage: "prospect",
    value_eur: 22000,
    expected_close_date: nextMonth,
    notes:
      "Eerste verkennend gesprek positief. Klant wil pilot draaien voordat ze grotere commitments maken.",
    created_at: "2024-03-18T09:00:00Z",
  },
  {
    id: "deal-4",
    organization_id: "org-1",
    organization_name: "ING Bank N.V.",
    job_id: null,
    job_title: null,
    recruiter_id: "user-3",
    recruiter_name: "Lisa Smits",
    title: "Plaatsing Data Engineer ING",
    stage: "gewonnen",
    value_eur: 32000,
    expected_close_date: thisMonth,
    notes:
      "Plaatsing succesvol. Factuur verzonden, betaling binnen 30 dagen verwacht.",
    created_at: "2024-02-20T08:00:00Z",
  },
  {
    id: "deal-5",
    organization_id: "org-2",
    organization_name: "Bol.com",
    job_id: null,
    job_title: null,
    recruiter_id: "user-2",
    recruiter_name: "Jan Peters",
    title: "Backend Engineer trial",
    stage: "verloren",
    value_eur: 18000,
    expected_close_date: "2024-02-28T00:00:00Z",
    notes:
      "Klant koos voor concurrent (lager tarief). Relatie behouden voor toekomstige opdrachten.",
    created_at: "2024-01-25T10:00:00Z",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Organizations hooks ────────────────────────────────────────────────────

export function useOrganizations() {
  return useQuery({
    queryKey: ["crm", "organizations"],
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: Organization[] }>(
          "/crm/organizations"
        );
        return data.data;
      } catch {
        return [...MOCK_ORGANIZATIONS];
      }
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (org: Partial<Organization>) => {
      try {
        const { data } = await api.post<Organization>(
          "/crm/organizations",
          org
        );
        return data;
      } catch {
        const newOrg: Organization = {
          id: `org-${Date.now()}`,
          name: org.name ?? "",
          industry: org.industry ?? null,
          website: org.website ?? null,
          notes: org.notes ?? null,
          type: org.type ?? "prospect",
          created_at: nowIso(),
        };
        MOCK_ORGANIZATIONS.unshift(newOrg);
        return newOrg;
      }
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
      try {
        const { data } = await api.patch<Organization>(
          `/crm/organizations/${id}`,
          updates
        );
        return data;
      } catch {
        const idx = MOCK_ORGANIZATIONS.findIndex((o) => o.id === id);
        if (idx !== -1) {
          MOCK_ORGANIZATIONS[idx] = { ...MOCK_ORGANIZATIONS[idx], ...updates };
          return MOCK_ORGANIZATIONS[idx];
        }
        throw new Error("Organisatie niet gevonden");
      }
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
      try {
        await api.delete(`/crm/organizations/${id}`);
      } catch {
        const idx = MOCK_ORGANIZATIONS.findIndex((o) => o.id === id);
        if (idx !== -1) MOCK_ORGANIZATIONS.splice(idx, 1);
      }
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
      try {
        const { data } = await api.get<{ data: CrmContact[] }>(
          "/crm/contacts",
          {
            params: organizationId ? { organization_id: organizationId } : undefined,
          }
        );
        return data.data;
      } catch {
        if (organizationId) {
          return MOCK_CONTACTS.filter((c) => c.organization_id === organizationId);
        }
        return [...MOCK_CONTACTS];
      }
    },
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contact: Partial<CrmContact>) => {
      try {
        const { data } = await api.post<CrmContact>("/crm/contacts", contact);
        return data;
      } catch {
        const newContact: CrmContact = {
          id: `ctc-${Date.now()}`,
          organization_id: contact.organization_id ?? "",
          name: contact.name ?? "",
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          role: contact.role ?? null,
          linkedin_url: contact.linkedin_url ?? null,
          created_at: nowIso(),
        };
        MOCK_CONTACTS.unshift(newContact);
        return newContact;
      }
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
      try {
        await api.delete(`/crm/contacts/${id}`);
      } catch {
        const idx = MOCK_CONTACTS.findIndex((c) => c.id === id);
        if (idx !== -1) MOCK_CONTACTS.splice(idx, 1);
      }
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
      try {
        const { data } = await api.get<{ data: CrmDeal[] }>("/crm/deals");
        return data.data;
      } catch {
        return [...MOCK_DEALS];
      }
    },
  });
}

export function useDealsPipeline() {
  return useQuery({
    queryKey: ["crm", "deals", "pipeline"],
    queryFn: async () => {
      try {
        const { data } = await api.get<Record<DealStage, CrmDeal[]>>(
          "/crm/deals/pipeline/board"
        );
        return data;
      } catch {
        const board: Record<DealStage, CrmDeal[]> = {
          prospect: [],
          offerte: [],
          onderhandeling: [],
          gewonnen: [],
          verloren: [],
        };
        for (const deal of MOCK_DEALS) {
          board[deal.stage].push(deal);
        }
        return board;
      }
    },
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deal: Partial<CrmDeal>) => {
      try {
        const { data } = await api.post<CrmDeal>("/crm/deals", deal);
        return data;
      } catch {
        const org = MOCK_ORGANIZATIONS.find(
          (o) => o.id === deal.organization_id
        );
        const newDeal: CrmDeal = {
          id: `deal-${Date.now()}`,
          organization_id: deal.organization_id ?? "",
          organization_name: org?.name,
          job_id: deal.job_id ?? null,
          job_title: deal.job_title ?? null,
          recruiter_id: deal.recruiter_id ?? "user-1",
          recruiter_name: deal.recruiter_name ?? "Emma Bakker",
          title: deal.title ?? "",
          stage: deal.stage ?? "prospect",
          value_eur: deal.value_eur ?? 0,
          expected_close_date: deal.expected_close_date ?? null,
          notes: deal.notes ?? null,
          created_at: nowIso(),
        };
        MOCK_DEALS.unshift(newDeal);
        return newDeal;
      }
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
      try {
        const { data } = await api.patch<CrmDeal>(`/crm/deals/${id}/stage`, {
          stage,
        });
        return data;
      } catch {
        const idx = MOCK_DEALS.findIndex((d) => d.id === id);
        if (idx !== -1) {
          MOCK_DEALS[idx] = { ...MOCK_DEALS[idx], stage };
          return MOCK_DEALS[idx];
        }
        throw new Error("Deal niet gevonden");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "deals"] });
    },
  });
}
