"use client";

/**
 * Sprint Q4.6 — Multi-channel compose-bar for the unified inbox.
 *
 * Each channel has its own input affordances:
 *   - email:    subject + body
 *   - whatsapp: template-picker (if outside 24h window) OR free-text
 *               (if inside session — shows countdown timer)
 *   - voice:    "Bel nu" button → initiates Twilio call
 *   - sms:      free-text (charcount → SMS-segment hint)
 *   - linkedin_*: free-text body
 *
 * Renders a GDPR-consent banner if WhatsApp/voice consent is missing for the
 * candidate.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Mail,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Phone,
  Send,
  Smile,
  Linkedin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { CHANNEL_THEME } from "@/components/inbox/ChannelIcon";
import {
  useInitiateCall,
  type VoiceIntegration,
} from "@/hooks/useVoice";
import {
  useSendWhatsAppMessage,
  useWhatsAppConsentForCandidate,
  useWhatsAppConversations,
  useWhatsAppTemplates,
  type WhatsAppIntegration,
} from "@/hooks/useWhatsApp";
import { useSendEmail } from "@/hooks/useSendEmail";
import type { ChannelType } from "@/lib/types/inbox";

interface ComposeBarProps {
  candidateId: string;
  candidateName: string;
  defaultChannel?: ChannelType;
  whatsappIntegration?: WhatsAppIntegration | null;
  /** False wanneer WhatsApp in deze omgeving niet geactiveerd is. */
  whatsappServiceActive?: boolean;
  voiceIntegration?: VoiceIntegration | null;
  /** False wanneer Voice in deze omgeving niet geactiveerd is. */
  voiceServiceActive?: boolean;
  allowedChannels?: ChannelType[];
}

const ALL_CHANNELS: ChannelType[] = [
  "email",
  "whatsapp",
  "sms",
  "voice",
  "linkedin_inmail",
];

// Snelle emoji-set voor de composer (geen extra dependency).
const QUICK_EMOJIS = [
  "😊", "👍", "🎉", "✅", "🙏", "💪", "🚀", "📞",
  "📅", "✨", "👏", "🤝", "💼", "⭐", "❤️", "😀",
];

const CHANNEL_ICON_COMPONENT: Record<ChannelType, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  voice: Phone,
  linkedin_inmail: Linkedin,
  linkedin_connection: Linkedin,
};

function useCountdown(target: string | null): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}u ${m}m`;
}

export function ComposeBar({
  candidateId,
  candidateName,
  defaultChannel = "email",
  whatsappIntegration,
  whatsappServiceActive = true,
  voiceIntegration,
  voiceServiceActive = true,
  allowedChannels = ALL_CHANNELS,
}: ComposeBarProps) {
  const { toast } = useToast();
  const [channel, setChannel] = useState<ChannelType>(defaultChannel);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [showEmoji, setShowEmoji] = useState(false);

  const { data: consent } = useWhatsAppConsentForCandidate(candidateId);
  const { data: conversations } = useWhatsAppConversations({ candidate_id: candidateId });
  const { data: templates } = useWhatsAppTemplates({ status: "approved" });

  const conv = conversations?.[0] ?? null;
  const sessionTimer = useCountdown(conv?.session_expires_at ?? null);
  const sessionOpen = !!sessionTimer;

  const sendWhatsApp = useSendWhatsAppMessage();
  const sendEmail = useSendEmail();
  const initiateCall = useInitiateCall();

  const whatsAppConnected =
    whatsappServiceActive && whatsappIntegration?.status === "connected";
  const voiceConnected =
    voiceServiceActive && voiceIntegration?.status === "connected";
  const consentGranted = consent?.status === "granted";
  // Vrije tekst (en dus emoji) kan op alle kanalen behalve voice, en bij
  // WhatsApp alleen binnen het open 24u-sessievenster.
  const canType =
    channel !== "voice" && !(channel === "whatsapp" && !sessionOpen);

  const channelDisabled = useMemo<Partial<Record<ChannelType, string>>>(() => {
    const reasons: Partial<Record<ChannelType, string>> = {};
    if (!whatsappServiceActive) reasons.whatsapp = "WhatsApp is niet geactiveerd";
    else if (!whatsAppConnected) reasons.whatsapp = "WhatsApp niet geconfigureerd";
    else if (!consentGranted) reasons.whatsapp = "Geen WhatsApp-toestemming van kandidaat";
    if (!voiceServiceActive) reasons.voice = "Voice is niet geactiveerd";
    else if (!voiceConnected) reasons.voice = "Twilio niet geconfigureerd";
    // Eerlijk: deze kanalen hebben (nog) geen echte backend. De oude compose
    // toonde "SMS verzonden" / "LinkedIn-InMail verzonden" zonder dat er ooit
    // iets werd verstuurd.
    reasons.sms = "SMS is niet beschikbaar in TalentFlow";
    reasons.linkedin_inmail = "LinkedIn-koppeling is nog niet beschikbaar";
    return reasons;
  }, [
    whatsappServiceActive,
    whatsAppConnected,
    consentGranted,
    voiceServiceActive,
    voiceConnected,
  ]);

  const handleSend = async () => {
    if (channel === "email") {
      if (!subject || !body) {
        toast({ title: "Onderwerp en bericht zijn verplicht", variant: "destructive" });
        return;
      }
      try {
        await sendEmail.mutateAsync({
          candidate_id: candidateId,
          subject,
          body_html: body,
        });
        toast({ title: "E-mail verzonden", description: `Naar ${candidateName}` });
        setSubject("");
        setBody("");
      } catch {
        toast({ title: "Versturen mislukt", variant: "destructive" });
      }
      return;
    }

    if (channel === "whatsapp") {
      try {
        if (sessionOpen) {
          if (!body) {
            toast({ title: "Bericht is leeg", variant: "destructive" });
            return;
          }
          await sendWhatsApp.mutateAsync({
            candidate_id: candidateId,
            kind: "text",
            body,
          });
          toast({ title: "WhatsApp-bericht verzonden" });
          setBody("");
        } else {
          if (!templateId) {
            toast({
              title: "Kies een template",
              description: "Buiten het 24u-venster is een template verplicht.",
              variant: "destructive",
            });
            return;
          }
          await sendWhatsApp.mutateAsync({
            candidate_id: candidateId,
            kind: "template",
            template_id: templateId,
          });
          toast({ title: "WhatsApp-template verzonden" });
          setTemplateId("");
        }
      } catch {
        toast({
          title: "Versturen mislukt",
          description:
            "Het WhatsApp-bericht is niet verstuurd. WhatsApp is mogelijk niet geactiveerd.",
          variant: "destructive",
        });
      }
      return;
    }

    if (channel === "voice") {
      try {
        const call = await initiateCall.mutateAsync({
          candidate_id: candidateId,
          candidate_name: candidateName,
        });
        toast({
          title: "Bellen gestart",
          description: `${candidateName} (${call.id})`,
        });
      } catch {
        toast({
          title: "Bellen mislukt",
          description:
            "Het gesprek kon niet gestart worden. Voice is mogelijk niet geactiveerd.",
          variant: "destructive",
        });
      }
      return;
    }

    if (channel === "sms") {
      // Eerlijk: er is geen SMS-backend — geen nep "SMS verzonden" meer.
      toast({
        title: "SMS is niet beschikbaar",
        description: "TalentFlow ondersteunt (nog) geen SMS-verzending.",
        variant: "destructive",
      });
      return;
    }

    if (channel === "linkedin_inmail") {
      // Eerlijk: er is geen LinkedIn-send-backend — geen nep-succes meer.
      toast({
        title: "LinkedIn-InMail is niet beschikbaar",
        description: "De LinkedIn-koppeling is nog niet beschikbaar.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="border-t border-border bg-white dark:bg-zinc-900">
      {/* Consent banner */}
      {channel === "whatsapp" && !consentGranted && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50/80 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Geen WhatsApp-toestemming van {candidateName}. Stuur een opt-in
            uitnodiging via{" "}
            <span className="font-semibold">Instellingen → WhatsApp → Consent</span>.
          </p>
        </div>
      )}
      {channel === "whatsapp" && consentGranted && sessionOpen && (
        <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Sessie open: {sessionTimer} over · vrije tekst is toegestaan
        </div>
      )}
      {channel === "whatsapp" && consentGranted && !sessionOpen && (
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          24u-sessie verlopen — kies een goedgekeurde template om opnieuw te beginnen.
        </div>
      )}

      {/* Channel selector */}
      <div className="flex items-center gap-1 px-3 pt-2">
        {allowedChannels.map((c) => {
          const Icon = CHANNEL_ICON_COMPONENT[c];
          const theme = CHANNEL_THEME[c];
          const disabled = channelDisabled[c];
          const active = channel === c;
          return (
            <button
              key={c}
              type="button"
              disabled={!!disabled}
              title={disabled ?? theme.label}
              onClick={() => setChannel(c)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                active
                  ? cn(theme.bg, theme.fg, "ring-1 ring-inset", theme.ring)
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                disabled && "opacity-40 cursor-not-allowed"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {theme.label}
            </button>
          );
        })}
      </div>

      {/* Input area */}
      <div className="space-y-2 p-3">
        {channel === "email" && (
          <Input
            placeholder="Onderwerp"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="h-9"
          />
        )}

        {channel === "whatsapp" && !sessionOpen && consentGranted && (
          <div className="relative">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Kies een goedgekeurde template…</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        )}

        {channel === "voice" ? (
          <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50/60 px-4 py-3 dark:border-purple-900/40 dark:bg-purple-950/30">
            <div>
              <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">
                Direct bellen via Twilio
              </p>
              <p className="text-xs text-purple-700/80 dark:text-purple-300/80">
                {voiceConnected
                  ? `Vanaf ${voiceIntegration?.phone_number}`
                  : "Geen Twilio-integratie geconfigureerd."}
              </p>
            </div>
            <Button
              type="button"
              onClick={handleSend}
              disabled={!voiceConnected || initiateCall.isPending}
              className="gap-1.5 bg-purple-600 hover:bg-purple-700"
            >
              <Phone className="h-4 w-4" />
              {initiateCall.isPending ? "Verbinden…" : "Bel nu"}
            </Button>
          </div>
        ) : (
          <Textarea
            placeholder={
              channel === "whatsapp" && !sessionOpen
                ? "Vrije tekst is uitgeschakeld — kies eerst een template."
                : `Typ een bericht aan ${candidateName}…`
            }
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={channel === "whatsapp" && !sessionOpen}
            className="min-h-[88px] resize-none"
          />
        )}

        {channel !== "voice" && (
          <div className="space-y-2">
            {showEmoji && canType && (
              <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-zinc-50 p-2 dark:bg-zinc-800/50">
                {QUICK_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setBody((b) => b + e)}
                    className="flex h-8 w-8 items-center justify-center rounded text-lg transition-colors hover:bg-white dark:hover:bg-zinc-700"
                    aria-label={`Emoji ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1.5 text-muted-foreground"
                  disabled
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Bijlage
                </Button>
                {canType && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowEmoji((v) => !v)}
                    className={cn(
                      "h-8 gap-1.5 text-xs text-muted-foreground",
                      showEmoji && "bg-zinc-100 text-foreground dark:bg-zinc-800"
                    )}
                    aria-label="Emoji toevoegen"
                  >
                    <Smile className="h-3.5 w-3.5" />
                    Emoji
                  </Button>
                )}
              </div>
              <Button
                type="button"
                onClick={handleSend}
                disabled={
                  sendEmail.isPending ||
                  sendWhatsApp.isPending ||
                  (channel === "whatsapp" && !sessionOpen && !templateId)
                }
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                Verzenden
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
