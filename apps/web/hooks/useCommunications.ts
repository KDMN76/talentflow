"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type CommunicationChannel = "email" | "whatsapp" | "sms";
export type CommunicationDirection = "inbound" | "outbound";

export interface Communication {
  id: string;
  candidate_id: string;
  candidate_name?: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  subject?: string;
  body: string;
  sent_at: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export function useCommunications(candidateId?: string) {
  return useQuery({
    queryKey: ["communications", candidateId ?? "all"],
    queryFn: async () => {
      if (candidateId) {
        const { data } = await api.get<Communication[]>(
          `/communications/candidates/${candidateId}`
        );
        return data;
      } else {
        const { data } = await api.get<Communication[]>(
          "/communications/inbox"
        );
        return data;
      }
    },
  });
}

export function useInbox() {
  return useQuery({
    queryKey: ["communications", "inbox"],
    queryFn: async (): Promise<Communication[]> => {
      // Backend wikkelt in { data: [...] }; geef de array terug (anders crasht
      // `.filter` op het wrapper-object → witte pagina /communications).
      const { data } = await api.get<{ data: Communication[] }>(
        "/communications/inbox"
      );
      return data.data ?? [];
    },
  });
}

interface SendMessagePayload {
  candidateId: string;
  channel: CommunicationChannel;
  body: string;
  subject?: string;
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      candidateId,
      channel,
      body,
      subject,
    }: SendMessagePayload): Promise<Communication> => {
      const { data } = await api.post<Communication>(
        `/communications/candidates/${candidateId}/${channel}`,
        { body, subject }
      );
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["communications"] });
      queryClient.invalidateQueries({
        queryKey: ["communications", variables.candidateId],
      });
      queryClient.invalidateQueries({
        queryKey: ["communications", "inbox"],
      });
    },
  });
}
