"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Candidate,
  CandidateResume,
  CandidateSkill,
  CreateCandidateInput,
  CreateCandidateSkillInput,
  PipelineTemplate,
  UpdateCandidateInput,
} from "@talentflow/shared";
import { api } from "@/lib/api";
import {
  mockCandidates,
  mockCandidateSkills,
  mockCandidateResumes,
  mockPipelineTemplates,
} from "@/lib/mockData";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a fully populated Candidate row from the (much smaller) write-input
 * shape. Used by the dev-mode mock fallback so the in-memory store keeps the
 * same shape as the API response.
 */
function buildMockCandidate(input: CreateCandidateInput): Candidate {
  const now = new Date().toISOString();
  const name =
    input.name ??
    [input.first_name, input.last_name].filter(Boolean).join(" ").trim() ??
    "Onbekend";

  return {
    id: `cand-${Date.now()}`,
    tenant_id: "tenant-1",
    candidate_reference: input.candidate_reference ?? null,
    created_at: now,
    updated_at: now,
    deleted_at: null,

    name: name || "Onbekend",
    first_name: input.first_name ?? null,
    last_name: input.last_name ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,

    gender: input.gender ?? null,
    birthdate: input.birthdate ?? null,
    nationalities: input.nationalities ?? null,
    languages: input.languages ?? null,

    notice_period: input.notice_period ?? null,
    current_salary: input.current_salary ?? null,
    current_salary_currency: input.current_salary_currency ?? null,
    expected_salary: input.expected_salary ?? null,
    expected_salary_currency: input.expected_salary_currency ?? null,
    current_benefits: input.current_benefits ?? null,
    expected_benefits: input.expected_benefits ?? null,
    years_of_experience: input.years_of_experience ?? null,
    graduation_date: input.graduation_date ?? null,
    current_department: input.current_department ?? null,
    current_position: input.current_position ?? null,
    current_company: input.current_company ?? null,
    industry: input.industry ?? null,

    diploma: input.diploma ?? null,
    university: input.university ?? null,

    address_line1: input.address_line1 ?? null,
    address_line2: input.address_line2 ?? null,
    address_city: input.address_city ?? null,
    address_country: input.address_country ?? null,
    address_postal_code: input.address_postal_code ?? null,

    skype: input.skype ?? null,
    other_contact: input.other_contact ?? null,

    description: input.description ?? null,
    source: input.source ?? "manual_import",

    gdpr_consent: input.gdpr_consent ?? false,
    gdpr_consent_at: input.gdpr_consent_at ?? null,
    email_consent: input.email_consent ?? false,
    email_consent_at: input.email_consent_at ?? null,

    resume_url: null,
    skills: input.skills ?? null,
    ai_score: null,
    tags: input.tags ?? null,
    notes: input.notes ?? null,

    candidate_skills: [],
    resumes: [],
  };
}

// ─── Candidate (collection / item) ──────────────────────────────────────────

export function useCandidates(search?: string) {
  return useQuery({
    queryKey: ["candidates", search],
    queryFn: async () => {
      try {
        const { data } = await api.get<{ data: Candidate[] }>("/candidates", { params: { search } });
        return data.data;
      } catch {
        const q = search?.toLowerCase();
        if (q) {
          return mockCandidates.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              (c.email?.toLowerCase().includes(q) ?? false) ||
              (c.skills ?? []).some((s) => s.toLowerCase().includes(q))
          );
        }
        return [...mockCandidates];
      }
    },
  });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: ["candidates", id],
    queryFn: async (): Promise<Candidate & { applications?: unknown[] }> => {
      try {
        const { data } = await api.get<Candidate & { applications: unknown[] }>(`/candidates/${id}`);
        return data;
      } catch {
        const candidate = mockCandidates.find((c) => c.id === id);
        if (!candidate) throw new Error("Kandidaat niet gevonden");
        return {
          ...candidate,
          candidate_skills: mockCandidateSkills.filter((s) => s.candidate_id === id),
          resumes: mockCandidateResumes.filter((r) => r.candidate_id === id),
        };
      }
    },
    enabled: !!id,
  });
}

export function useCreateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (candidate: CreateCandidateInput): Promise<Candidate> => {
      try {
        const { data } = await api.post<Candidate>("/candidates", candidate);
        return data;
      } catch {
        const newCandidate = buildMockCandidate(candidate);
        mockCandidates.unshift(newCandidate);
        return newCandidate;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
    },
  });
}

export function useUpdateCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<UpdateCandidateInput> & { id: string }): Promise<Candidate> => {
      try {
        const { data } = await api.patch<Candidate>(`/candidates/${id}`, updates);
        return data;
      } catch {
        const idx = mockCandidates.findIndex((c) => c.id === id);
        if (idx !== -1) {
          mockCandidates[idx] = {
            ...mockCandidates[idx],
            ...(updates as Partial<Candidate>),
            updated_at: new Date().toISOString(),
          };
          return mockCandidates[idx];
        }
        throw new Error("Kandidaat niet gevonden");
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["candidates"] });
      queryClient.invalidateQueries({ queryKey: ["candidates", variables.id] });
    },
  });
}

// ─── Candidate skills ───────────────────────────────────────────────────────

export function useCandidateSkills(candidateId: string) {
  return useQuery({
    queryKey: ["candidates", candidateId, "skills"],
    queryFn: async (): Promise<CandidateSkill[]> => {
      try {
        const { data } = await api.get<{ data: CandidateSkill[] }>(
          `/candidates/${candidateId}/skills`
        );
        return data.data;
      } catch {
        return mockCandidateSkills.filter((s) => s.candidate_id === candidateId);
      }
    },
    enabled: !!candidateId,
  });
}

export function useAddCandidateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      ...input
    }: CreateCandidateSkillInput & { candidateId: string }): Promise<CandidateSkill> => {
      try {
        const { data } = await api.post<CandidateSkill>(
          `/candidates/${candidateId}/skills`,
          input
        );
        return data;
      } catch {
        const newSkill: CandidateSkill = {
          id: `skill-${Date.now()}`,
          candidate_id: candidateId,
          skill: input.skill,
          score: input.score ?? null,
          source: input.source ?? "manual",
          created_at: new Date().toISOString(),
        };
        mockCandidateSkills.unshift(newSkill);
        return newSkill;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId, "skills"],
      });
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId],
      });
    },
  });
}

export function useDeleteCandidateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      skillId,
    }: {
      candidateId: string;
      skillId: string;
    }): Promise<void> => {
      try {
        await api.delete(`/candidates/${candidateId}/skills/${skillId}`);
      } catch {
        const idx = mockCandidateSkills.findIndex((s) => s.id === skillId);
        if (idx !== -1) mockCandidateSkills.splice(idx, 1);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId, "skills"],
      });
      queryClient.invalidateQueries({
        queryKey: ["candidates", variables.candidateId],
      });
    },
  });
}

// ─── Candidate resumes ──────────────────────────────────────────────────────

/**
 * Returns all resumes for the given candidate.
 *
 * Auto-polls every 3 seconds while at least one resume is in `pending` or
 * `processing` state, and stops as soon as the queue is drained — so the UI
 * reflects AI-parsing progress without manual refresh, and idle candidates
 * don't waste requests.
 */
export function useCandidateResumes(candidateId: string) {
  return useQuery({
    queryKey: ["candidate-resumes", candidateId],
    queryFn: async (): Promise<CandidateResume[]> => {
      try {
        const { data } = await api.get<{ data: CandidateResume[] }>(
          `/candidates/${candidateId}/resumes`
        );
        return data.data;
      } catch {
        return mockCandidateResumes.filter((r) => r.candidate_id === candidateId);
      }
    },
    enabled: !!candidateId,
    refetchInterval: (query) => {
      const data = query.state.data as CandidateResume[] | undefined;
      if (!data || data.length === 0) return false;
      const stillRunning = data.some(
        (r) => r.parse_status === "pending" || r.parse_status === "processing"
      );
      return stillRunning ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

/**
 * Upload one or more resume files for a candidate.
 *
 * Accepts either a `FormData` (already containing `files` entries) or an
 * array of `File` objects, which is converted internally. Mock-fallback
 * synthesises pending CandidateResume rows so the UI in dev mode shows the
 * same upload-then-parse lifecycle.
 */
export function useUploadCandidateResumes(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: File[] | FormData): Promise<CandidateResume[]> => {
      const formData =
        input instanceof FormData
          ? input
          : (() => {
              const fd = new FormData();
              input.forEach((file) => fd.append("files", file));
              return fd;
            })();

      try {
        const { data } = await api.post<{ data: CandidateResume[] }>(
          `/candidates/${candidateId}/resumes`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } }
        );
        return data.data;
      } catch {
        // Mock fallback: build pending rows and simulate a parse → done transition.
        const files: File[] =
          input instanceof FormData
            ? (input.getAll("files").filter((f) => f instanceof File) as File[])
            : input;

        const now = new Date().toISOString();
        const candidateHasPrimary = mockCandidateResumes.some(
          (r) => r.candidate_id === candidateId && r.is_primary
        );

        const created: CandidateResume[] = files.map((file, idx) => ({
          id: `resume-${Date.now()}-${idx}`,
          candidate_id: candidateId,
          filename: file.name,
          storage_url: URL.createObjectURL(file),
          storage_key: `tenant-1/${candidateId}/${file.name}`,
          mime_type: file.type || null,
          size_bytes: file.size,
          is_primary: !candidateHasPrimary && idx === 0,
          parsed_at: null,
          created_at: now,
          parse_status: "pending",
          parse_error: null,
          ai_summary: null,
        }));

        mockCandidateResumes.unshift(...created);

        // Simulate the worker: pending → processing → done after a short delay
        // so the polling-based UI can demonstrate the full state machine.
        created.forEach((row, i) => {
          setTimeout(() => {
            const idx = mockCandidateResumes.findIndex((r) => r.id === row.id);
            if (idx !== -1) {
              mockCandidateResumes[idx] = {
                ...mockCandidateResumes[idx],
                parse_status: "processing",
              };
              queryClient.invalidateQueries({
                queryKey: ["candidate-resumes", candidateId],
              });
            }
          }, 1500 + i * 300);

          setTimeout(() => {
            const idx = mockCandidateResumes.findIndex((r) => r.id === row.id);
            if (idx !== -1) {
              mockCandidateResumes[idx] = {
                ...mockCandidateResumes[idx],
                parse_status: "done",
                parsed_at: new Date().toISOString(),
                ai_summary:
                  "Mock-AI-samenvatting: ervaren professional met sterke skills in het werkveld. Duidelijke werkervaring en relevante opleiding. Geanalyseerd in dev-mode (mock fallback).",
              };
              queryClient.invalidateQueries({
                queryKey: ["candidate-resumes", candidateId],
              });
            }
          }, 4000 + i * 500);
        });

        return created;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

/**
 * Delete a single resume from a candidate.
 */
export function useDeleteCandidateResume(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resumeId: string): Promise<void> => {
      try {
        await api.delete(`/candidates/${candidateId}/resumes/${resumeId}`);
      } catch {
        const idx = mockCandidateResumes.findIndex((r) => r.id === resumeId);
        if (idx !== -1) mockCandidateResumes.splice(idx, 1);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

/**
 * Mark a resume as the candidate's primary CV. Only one resume per candidate
 * may be primary at a time — the API enforces this server-side; the mock
 * fallback mirrors that invariant locally.
 */
export function useSetPrimaryResume(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (resumeId: string): Promise<void> => {
      try {
        await api.patch(`/candidates/${candidateId}/resumes/${resumeId}/primary`);
      } catch {
        mockCandidateResumes.forEach((r, i) => {
          if (r.candidate_id === candidateId) {
            mockCandidateResumes[i] = { ...r, is_primary: r.id === resumeId };
          }
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["candidate-resumes", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["candidates", candidateId] });
    },
  });
}

// ─── Pipeline templates ─────────────────────────────────────────────────────

export function usePipelineTemplates() {
  return useQuery({
    queryKey: ["candidates", "pipeline-templates"],
    queryFn: async (): Promise<PipelineTemplate[]> => {
      try {
        const { data } = await api.get<{ data: PipelineTemplate[] }>(
          "/candidates/pipeline-templates"
        );
        return data.data;
      } catch {
        return [...mockPipelineTemplates];
      }
    },
  });
}
