/**
 * CommunicationsSection — read-only thread-overzicht van berichten met de tenant.
 *
 * Toont email/WhatsApp/SMS-summaries met datum + onderwerp + richtingen-indicator.
 * Read-only by design — kandidaten kunnen hier niet replyen (dat gaat via reply
 * op de oorspronkelijke e-mail).
 */

"use client";

import { ArrowLeft, ArrowRight, Mail, MessageCircle, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { SelfServiceCommunication } from "@/lib/mockData";

interface CommunicationsSectionProps {
  communications: SelfServiceCommunication[];
}

export function CommunicationsSection({ communications }: CommunicationsSectionProps) {
  const sorted = [...communications].sort(
    (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
              <Mail className="h-4 w-4" />
            </span>
            Mijn communicatie
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Een chronologisch overzicht van alle berichten tussen jou en het
            recruitment-team. Alleen-lezen.
          </p>
        </div>

        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-sm text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/40">
            Er is nog geen communicatie tussen jou en het recruitment-team.
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800">
                  <ChannelIcon channel={c.channel} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {c.subject ?? defaultSubject(c.channel)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {c.direction === "outbound" ? (
                        <>
                          <ArrowLeft className="h-2.5 w-2.5" />
                          Aan jou
                        </>
                      ) : (
                        <>
                          <ArrowRight className="h-2.5 w-2.5" />
                          Van jou
                        </>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {c.summary}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {formatNl(c.sent_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelIcon({ channel }: { channel: SelfServiceCommunication["channel"] }) {
  if (channel === "email") return <Mail className="h-3.5 w-3.5 text-indigo-600" />;
  if (channel === "whatsapp")
    return <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />;
  return <Phone className="h-3.5 w-3.5 text-blue-600" />;
}

function defaultSubject(c: SelfServiceCommunication["channel"]): string {
  if (c === "email") return "(geen onderwerp)";
  if (c === "whatsapp") return "WhatsApp-bericht";
  return "SMS-bericht";
}

function formatNl(iso: string): string {
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
