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

const MOCK_INBOX: Communication[] = [
  {
    id: "m1",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    channel: "email",
    direction: "outbound",
    subject: "Uitnodiging voor interview",
    body: "Beste Sophie, we nodigen u graag uit voor een gesprek op ons kantoor.",
    sent_at: "2024-01-25T14:00:00Z",
    status: "read",
  },
  {
    id: "m2",
    candidate_id: "cand-1",
    candidate_name: "Sophie van den Berg",
    channel: "email",
    direction: "inbound",
    subject: "Re: Uitnodiging voor interview",
    body: "Bedankt voor de uitnodiging! Donderdag om 10:00 is perfect voor mij.",
    sent_at: "2024-01-25T15:30:00Z",
    status: "read",
  },
  {
    id: "m3",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    channel: "whatsapp",
    direction: "outbound",
    body: "Hi Thomas, je technische test staat klaar. Je hebt 48 uur om hem in te dienen.",
    sent_at: "2024-01-24T09:00:00Z",
    status: "delivered",
  },
  {
    id: "m4",
    candidate_id: "cand-3",
    candidate_name: "Aisha El Hamdouchi",
    channel: "email",
    direction: "outbound",
    subject: "Volgende stap: telefonische screening",
    body: "Beste Aisha, we willen graag een kort gesprek inplannen.",
    sent_at: "2024-01-23T11:00:00Z",
    status: "sent",
  },
  {
    id: "m5",
    candidate_id: "cand-5",
    candidate_name: "Maya Okonkwo",
    channel: "sms",
    direction: "outbound",
    body: "Hi Maya, we bellen je morgen om 14:00 voor een korte kennismaking.",
    sent_at: "2024-01-22T16:00:00Z",
    status: "delivered",
  },
  {
    id: "m6",
    candidate_id: "cand-2",
    candidate_name: "Thomas Janssen",
    channel: "whatsapp",
    direction: "inbound",
    body: "Goed, ik ga ermee aan de slag! Bedankt.",
    sent_at: "2024-01-24T10:15:00Z",
    status: "read",
  },
];

export function useCommunications(candidateId?: string) {
  return useQuery({
    queryKey: ["communications", candidateId ?? "all"],
    queryFn: async () => {
      try {
        if (candidateId) {
          const { data } = await api.get<Communication[]>(
            `/api/communications/candidates/${candidateId}`
          );
          return data;
        } else {
          const { data } = await api.get<Communication[]>(
            "/api/communications/inbox"
          );
          return data;
        }
      } catch {
        if (candidateId) {
          return MOCK_INBOX.filter((m) => m.candidate_id === candidateId);
        }
        return MOCK_INBOX;
      }
    },
  });
}

export function useInbox() {
  return useQuery({
    queryKey: ["communications", "inbox"],
    queryFn: async () => {
      try {
        const { data } = await api.get<Communication[]>(
          "/api/communications/inbox"
        );
        return data;
      } catch {
        return MOCK_INBOX;
      }
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
      try {
        const { data } = await api.post<Communication>(
          `/api/communications/candidates/${candidateId}/${channel}`,
          { body, subject }
        );
        return data;
      } catch {
        const optimistic: Communication = {
          id: `local-${Date.now()}`,
          candidate_id: candidateId,
          channel,
          direction: "outbound",
          subject,
          body,
          sent_at: new Date().toISOString(),
          status: "sent",
        };
        return optimistic;
      }
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
