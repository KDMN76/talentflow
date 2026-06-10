"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Mail, Phone, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials, getScoreColor } from "@/lib/utils";
import type { Candidate } from "@/lib/mockData";

interface CandidateCardProps {
  candidate: Candidate;
}

const sourceColors: Record<string, string> = {
  LinkedIn: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  Indeed: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  Referral: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Career Fair": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Behance: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  Manual: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};

export function CandidateCard({ candidate }: CandidateCardProps) {
  const { t } = useTranslation("candidates");
  const initials = getInitials(candidate.name);
  const skills = candidate.skills ?? [];
  const tags = candidate.tags ?? [];
  // Kleur-lookup op de rauwe API-waarde; alleen de wéérgave van een
  // ontbrekende source wordt vertaald.
  const sourceLabel = candidate.source ?? t("card.unknownSource");
  const sourceColor =
    sourceColors[candidate.source ?? ""] ??
    "bg-zinc-100 text-zinc-700";

  return (
    <Link href={`/candidates/${candidate.id}`}>
      <Card className="border-0 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 cursor-pointer group">
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-indigo-600 transition-colors">
                  {candidate.name}
                </p>
                {candidate.ai_score !== null && (
                  <span
                    className={cn(
                      "flex-shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold",
                      getScoreColor(candidate.ai_score)
                    )}
                  >
                    {candidate.ai_score}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" />
                <span className="truncate">{candidate.email ?? ""}</span>
              </div>
            </div>
          </div>

          {/* Source + skills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                sourceColor
              )}
            >
              {sourceLabel}
            </span>
            {skills.slice(0, 3).map((skill) => (
              <Badge key={skill} variant="secondary" className="text-xs font-normal">
                {skill}
              </Badge>
            ))}
            {skills.length > 3 && (
              <Badge variant="outline" className="text-xs font-normal">
                +{skills.length - 3}
              </Badge>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-sm bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
