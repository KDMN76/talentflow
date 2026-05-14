"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MessageCircle, Phone, Search, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInbox } from "@/hooks/useCommunications";
import type { Communication, CommunicationChannel } from "@/hooks/useCommunications";

function formatTime(sentAt: string): string {
  const date = new Date(sentAt);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }

  return date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function ChannelIcon({ channel }: { channel: CommunicationChannel }) {
  if (channel === "email")
    return <Mail className="h-4 w-4 text-indigo-600 shrink-0" />;
  if (channel === "whatsapp")
    return <MessageCircle className="h-4 w-4 text-emerald-600 shrink-0" />;
  return <Phone className="h-4 w-4 text-blue-600 shrink-0" />;
}

function StatusDot({ status }: { status: Communication["status"] }) {
  const color =
    status === "read" || status === "delivered"
      ? "bg-emerald-500"
      : status === "sent"
      ? "bg-amber-500"
      : "bg-red-500";
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />;
}

function DirectionBadge({ direction }: { direction: Communication["direction"] }) {
  if (direction === "outbound") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
        → Uit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      ← In
    </span>
  );
}

type ChannelFilter = "all" | CommunicationChannel;

export default function CommunicationsPage() {
  const { data: messages, isLoading } = useInbox();
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = (messages ?? []).filter((m) => {
    const matchesChannel =
      channelFilter === "all" || m.channel === channelFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      m.candidate_name?.toLowerCase().includes(q) ||
      m.body.toLowerCase().includes(q);
    return matchesChannel && matchesSearch;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Berichten"
        description="Alle communicatie met kandidaten op één plek"
      />

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={channelFilter}
          onValueChange={(v) => setChannelFilter(v as ChannelFilter)}
        >
          <TabsList className="h-9">
            <TabsTrigger value="all" className="text-xs px-3">
              Alle
            </TabsTrigger>
            <TabsTrigger value="email" className="text-xs px-3">
              E-mail
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="text-xs px-3">
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="sms" className="text-xs px-3">
              SMS
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Zoek op naam of bericht…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
          />
        </div>
      </div>

      {/* Message list */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800 mb-4">
              <MessageSquare className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              Geen berichten gevonden
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Pas je filters aan of stuur een eerste bericht.
            </p>
          </div>
        ) : (
          filtered.map((msg) => (
            <Link
              key={msg.id}
              href={`/candidates/${msg.candidate_id}`}
              className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group"
            >
              {/* Channel icon */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 mt-0.5">
                <ChannelIcon channel={msg.channel} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 transition-colors">
                    {msg.candidate_name ?? "Onbekende kandidaat"}
                  </span>
                  <DirectionBadge direction={msg.direction} />
                </div>
                {msg.subject && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {msg.subject}
                  </p>
                )}
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5 leading-snug">
                  {truncate(msg.body, 60)}
                </p>
              </div>

              {/* Right: time + status */}
              <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatTime(msg.sent_at)}
                </span>
                <StatusDot status={msg.status} />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
