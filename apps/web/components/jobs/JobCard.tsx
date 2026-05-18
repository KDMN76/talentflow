import Link from "next/link";
import { MapPin, Users, Building2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, getInitials, formatRelativeDate } from "@/lib/utils";
import type { JobListItem as Job } from "@talentflow/contracts";

const statusConfig: Record<
  string,
  { label: string; className: string }
> = {
  draft: {
    label: "Concept",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  open: {
    label: "Open",
    className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400",
  },
  filled: {
    label: "Gevuld",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
  },
  closed: {
    label: "Gesloten",
    className: "bg-red-100 text-red-600 dark:bg-red-950/30 dark:text-red-400",
  },
};

interface JobCardProps {
  job: Job;
}

export function JobCard({ job }: JobCardProps) {
  const status = statusConfig[job.status] ?? statusConfig.draft;
  // Schema laat NULL toe op recruiter_id/recruiter_name (LEFT JOIN), department,
  // location en application_count komt soms als string van COUNT(). Defensief
  // renderen voorkomt witte pagina door één rij die kapot gaat.
  const recruiterName = job.recruiter_name ?? null;
  const department = job.department ?? null;
  const location = job.location ?? null;
  const applicationCount =
    typeof job.application_count === "number"
      ? job.application_count
      : Number(job.application_count ?? 0);

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-all duration-200 group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Link
                href={`/jobs/${job.id}`}
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 transition-colors"
              >
                {job.title}
              </Link>
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold",
                  status.className
                )}
              >
                {status.label}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {department && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  {department}
                </span>
              )}
              {location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {location}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                {applicationCount} sollicitanten
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400 text-xs font-semibold">
                {getInitials(recruiterName)}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Recruiter: {recruiterName ?? "Niet toegewezen"} · {formatRelativeDate(job.created_at)}
          </p>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              asChild
            >
              <Link href={`/jobs/${job.id}`}>Details</Link>
            </Button>
            {job.status !== "draft" && (
              <Button
                size="sm"
                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 border-0"
                asChild
              >
                <Link href={`/jobs/${job.id}/pipeline`}>
                  Pipeline
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
