"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  mockInterviews,
  mockRecordings,
  mockTranscripts,
} from "@/lib/mockData";
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
      try {
        const { data } = await api.get<{ data: InterviewRecording[] }>(
          `/interviews/${interviewId}/recordings`
        );
        return data.data;
      } catch {
        return mockRecordings[interviewId] ?? [];
      }
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
      try {
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
      } catch {
        // Mock-mode fake-progress so the UI's progress bar still animates.
        if (onProgress) {
          for (let p = 0; p <= 100; p += 20) {
            onProgress({
              loaded: (file.size * p) / 100,
              total: file.size,
              percent: p,
            });
            await new Promise((r) => setTimeout(r, 80));
          }
        }
        const now = new Date().toISOString();
        const newRow: InterviewRecording = {
          id: `rec-mock-${Date.now()}`,
          interview_id: interviewId,
          filename: file.name,
          size_bytes: file.size,
          duration_seconds: Math.round(file.size / 16_000), // rough heuristic
          storage_url: URL.createObjectURL(file),
          consent_given: true,
          consent_given_at: now,
          consent_given_by_id: "candidate-unknown",
          uploaded_by_id: "user-1",
          uploaded_by_name: "Emma Bakker",
          transcript_status: "queued",
          created_at: now,
        };
        if (!mockRecordings[interviewId]) mockRecordings[interviewId] = [];
        mockRecordings[interviewId].unshift(newRow);
        // Mark the interview itself as having a recording.
        const iv = mockInterviews.find((i) => i.id === interviewId);
        if (iv) iv.has_recording = true;
        return newRow;
      }
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
      try {
        const { data } = await api.get<InterviewTranscript>(
          `/interviews/recordings/${recordingId}/transcript`
        );
        return data;
      } catch {
        return mockTranscripts[recordingId] ?? null;
      }
    },
    enabled: !!recordingId,
    // Refetch every 10s while still processing — long-poll style.
    refetchInterval: (query) => {
      const data = query.state.data as InterviewTranscript | null | undefined;
      if (!data) return 10_000;
      return data.status === "done" || data.status === "failed" ? false : 10_000;
    },
  });
}
