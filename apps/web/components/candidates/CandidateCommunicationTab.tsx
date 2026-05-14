"use client";

/**
 * Sprint Q4.6 — Candidate-detail "Communicatie"-tab.
 *
 * Renders a unified timeline of every channel (email/whatsapp/sms/voice/linkedin)
 * scoped to this candidate. Reuses ChannelBubble for visual consistency with
 * the inbox.
 */

import { useMemo } from "react";
import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelBubble } from "@/components/inbox/ChannelBubble";
import { useInboxThreads, useThreadTimeline } from "@/hooks/useInbox";
import { useVoiceCalls } from "@/hooks/useVoice";
import { useWhatsAppMessages } from "@/hooks/useWhatsApp";
import type { TimelineEvent } from "@/lib/types/inbox";

interface Props {
  candidateId: string;
  candidateName: string;
}

export function CandidateCommunicationTab({ candidateId, candidateName }: Props) {
  // Find any inbox-thread for this candidate (if AAAA backend is wired up)
  const { data: allThreads } = useInboxThreads({});
  const thread = useMemo(
    () => (allThreads ?? []).find((t) => t.candidate_id === candidateId),
    [allThreads, candidateId]
  );
  const { data: timeline, isLoading: tlLoading } = useThreadTimeline(thread?.id);

  // Fallback: synthesize timeline from per-channel hooks when no thread exists yet
  const { data: waMessages } = useWhatsAppMessages({ candidate_id: candidateId });
  const { data: voiceCalls } = useVoiceCalls({ candidate_id: candidateId });

  const synthesized = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];
    for (const m of waMessages ?? []) {
      events.push({
        id: `wa-${m.id}`,
        channel: "whatsapp",
        direction: m.direction,
        timestamp: m.sent_at ?? m.created_at,
        sender_name:
          m.direction === "outbound" ? "Jij" : candidateName,
        preview: m.body_text ?? "(media)",
        body: m.body_text ?? "(media)",
        attachments: m.media_url
          ? [{ url: m.media_url, mime: m.media_mime ?? "application/octet-stream" }]
          : [],
        metadata: { status: m.status },
      });
    }
    for (const c of voiceCalls ?? []) {
      events.push({
        id: `vc-${c.id}`,
        channel: "voice",
        direction: c.direction,
        timestamp: c.started_at ?? c.created_at,
        sender_name: c.direction === "outbound" ? "Jij" : candidateName,
        preview:
          c.voicemail
            ? `Voicemail — ${c.duration_seconds}s`
            : `${c.direction === "inbound" ? "Inkomend" : "Uitgaand"} — ${c.duration_seconds}s`,
        body:
          c.transcription_text ??
          (c.voicemail
            ? "Voicemail ontvangen — wacht op transcriptie."
            : "Gesprek — geen transcriptie."),
        attachments: c.recording_url
          ? [{ url: c.recording_url, mime: "audio/mp3", name: `call-${c.id}.mp3` }]
          : [],
        metadata: { call_id: c.id, duration_seconds: c.duration_seconds, voicemail: c.voicemail },
      });
    }
    return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [waMessages, voiceCalls, candidateName]);

  const events = (timeline && timeline.length > 0 ? timeline : synthesized).slice().sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp)
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-emerald-500" />
          Communicatie ({events.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tlLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-3/4 rounded-2xl" />
            <Skeleton className="ml-auto h-20 w-3/4 rounded-2xl" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nog geen communicatie met deze kandidaat.
          </p>
        ) : (
          <div className="space-y-4">
            {events.map((e) => (
              <ChannelBubble key={e.id} event={e} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
