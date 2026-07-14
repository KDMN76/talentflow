"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unwrapData } from "@/lib/apiEnvelope";
import type {
  InterviewRecording,
  InterviewTranscript,
  UploadRecordingInput,
} from "@/lib/types/interviews";

export function useRecordings(interviewId: string | null) {
  return useQuery({
    queryKey: ["interview-recordings", interviewId],
    queryFn: async (): Promise<InterviewRecording[]> => {
      if (!interviewId) return [];
      const { data } = await api.get<{ data: InterviewRecording[] }>(
        `/interviews/${interviewId}/recordings`
      );
      return data.data;
    },
    enabled: !!interviewId,
  });
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export function useUploadRecording(interviewId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    InterviewRecording,
    Error,
    UploadRecordingInput & { onProgress?: (p: UploadProgress) => void }
  >({
    mutationFn: async ({ file, consent_given, onProgress }) => {
      if (!consent_given) {
        throw new Error(
          "AVG-toestemming is verplicht — vink het toestemmings-vakje aan."
        );
      }
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("consent_given", "true");
      const { data } = await api.post<InterviewRecording>(
        `/interviews/${interviewId}/recordings`,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e) => {
            if (!onProgress) return;
            const total = e.total ?? file.size;
            onProgress({
              loaded: e.loaded,
              total,
              percent: Math.round((e.loaded / total) * 100),
            });
          },
        }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["interview-recordings", interviewId],
      });
      queryClient.invalidateQueries({ queryKey: ["interviews"] });
      queryClient.invalidateQueries({ queryKey: ["interview", interviewId] });
    },
  });
}

export function useTranscript(recordingId: string | null) {
  return useQuery({
    queryKey: ["interview-transcript", recordingId],
    queryFn: async (): Promise<InterviewTranscript | null> => {
      if (!recordingId) return null;
      const { data } = await api.get<unknown>(
        `/interviews/recordings/${recordingId}/transcript`
      );
      return unwrapData<InterviewTranscript>(data);
    },
    enabled: !!recordingId,
    // Refetch every 10s while still processing — long-poll style.
    refetchInterval: (query) => {
      const data = query.state.data as InterviewTranscript | null | undefined;
      if (!data) return 10_000;
      const terminal =
        data.status === "done" ||
        data.status === "failed" ||
        data.status === "skipped";
      return terminal ? false : 10_000;
    },
  });
}
