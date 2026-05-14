import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { mockInterviewKits } from "@/lib/mockData";
import type {
  CreateInterviewKitInput,
  InterviewKit,
} from "@/lib/types/interviews";

export function useInterviewKits(jobId?: string | null) {
  return useQuery({
    queryKey: ["interview-kits", jobId ?? null],
    queryFn: async (): Promise<InterviewKit[]> => {
      try {
        const { data } = await api.get<{ data: InterviewKit[] }>(
          "/interview-kits",
          { params: { job_id: jobId ?? undefined } }
        );
        return data.data;
      } catch {
        // When a job_id is provided we still surface generic kits (those with
        // job_id === null) so the user always has the cultural-fit fallback.
        return mockInterviewKits.filter((k) => {
          if (!jobId) return true;
          return k.job_id === null || k.job_id === jobId;
        });
      }
    },
  });
}

export function useInterviewKit(id: string | null) {
  return useQuery({
    queryKey: ["interview-kit", id],
    queryFn: async (): Promise<InterviewKit | null> => {
      if (!id) return null;
      try {
        const { data } = await api.get<InterviewKit>(`/interview-kits/${id}`);
        return data;
      } catch {
        return mockInterviewKits.find((k) => k.id === id) ?? null;
      }
    },
    enabled: !!id,
  });
}

export function useCreateInterviewKit() {
  const queryClient = useQueryClient();
  return useMutation<InterviewKit, Error, CreateInterviewKitInput>({
    mutationFn: async (input) => {
      try {
        const { data } = await api.post<InterviewKit>("/interview-kits", input);
        return data;
      } catch {
        const now = new Date().toISOString();
        const newKit: InterviewKit = {
          id: `kit-mock-${Date.now()}`,
          tenant_id: "tenant-1",
          name: input.name,
          description: input.description ?? null,
          job_id: input.job_id ?? null,
          job_title: null,
          scorecard_template_id: input.scorecard_template_id ?? null,
          scorecard_template_name: null,
          questions: input.questions.map((q, i) => ({
            id: q.id ?? `q-mock-${Date.now()}-${i}`,
            text: q.text,
            category: q.category,
            suggested_followups: q.suggested_followups ?? [],
            evaluation_criteria: q.evaluation_criteria ?? null,
            expected_duration_minutes: q.expected_duration_minutes,
            position: i + 1,
          })),
          created_at: now,
          updated_at: now,
        };
        mockInterviewKits.unshift(newKit);
        return newKit;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interview-kits"] });
    },
  });
}

export function useUpdateInterviewKit(id: string) {
  const queryClient = useQueryClient();
  return useMutation<InterviewKit, Error, Partial<CreateInterviewKitInput>>({
    mutationFn: async (input) => {
      try {
        const { data } = await api.patch<InterviewKit>(
          `/interview-kits/${id}`,
          input
        );
        return data;
      } catch {
        const kit = mockInterviewKits.find((k) => k.id === id);
        if (!kit) throw new Error("Kit niet gevonden");
        if (input.name !== undefined) kit.name = input.name;
        if (input.description !== undefined)
          kit.description = input.description ?? null;
        if (input.job_id !== undefined) kit.job_id = input.job_id ?? null;
        if (input.scorecard_template_id !== undefined) {
          kit.scorecard_template_id = input.scorecard_template_id ?? null;
        }
        if (input.questions !== undefined) {
          kit.questions = input.questions.map((q, i) => ({
            id: q.id ?? `q-mock-${Date.now()}-${i}`,
            text: q.text,
            category: q.category,
            suggested_followups: q.suggested_followups ?? [],
            evaluation_criteria: q.evaluation_criteria ?? null,
            expected_duration_minutes: q.expected_duration_minutes,
            position: i + 1,
          }));
        }
        kit.updated_at = new Date().toISOString();
        return kit;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["interview-kits"] });
      queryClient.invalidateQueries({ queryKey: ["interview-kit", data.id] });
    },
  });
}

export function useDeleteInterviewKit() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      try {
        await api.delete(`/interview-kits/${id}`);
      } catch {
        const idx = mockInterviewKits.findIndex((k) => k.id === id);
        if (idx !== -1) mockInterviewKits.splice(idx, 1);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interview-kits"] });
    },
  });
}
