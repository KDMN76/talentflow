"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CreateInterviewKitInput,
  InterviewKit,
} from "@/lib/types/interviews";

export function useInterviewKits(jobId?: string | null) {
  return useQuery({
    queryKey: ["interview-kits", jobId ?? null],
    queryFn: async (): Promise<InterviewKit[]> => {
      const { data } = await api.get<{ data: InterviewKit[] }>(
        "/interview-kits",
        { params: { job_id: jobId ?? undefined } }
      );
      return data.data;
    },
  });
}

export function useInterviewKit(id: string | null) {
  return useQuery({
    queryKey: ["interview-kit", id],
    queryFn: async (): Promise<InterviewKit | null> => {
      if (!id) return null;
      const { data } = await api.get<InterviewKit>(`/interview-kits/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateInterviewKit() {
  const queryClient = useQueryClient();
  return useMutation<InterviewKit, Error, CreateInterviewKitInput>({
    mutationFn: async (input) => {
      const { data } = await api.post<InterviewKit>("/interview-kits", input);
      return data;
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
      const { data } = await api.patch<InterviewKit>(
        `/interview-kits/${id}`,
        input
      );
      return data;
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
      await api.delete(`/interview-kits/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interview-kits"] });
    },
  });
}
