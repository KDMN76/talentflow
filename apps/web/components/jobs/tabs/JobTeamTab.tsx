"use client";

import { useState } from "react";
import { Plus, Trash2, UserCog, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useAddJobTeamMember,
  useJobTeam,
  useRemoveJobTeamMember,
} from "@/hooks/useJobDetail";
import { AgreementMatrixView } from "@/components/interviews/AgreementMatrixView";
import { useTenantUsers } from "@/hooks/useUsers";
import { useApplications } from "@/hooks/usePipeline";
import { useScorecardsForApplication } from "@/hooks/useScorecards";
import type { JobTeamMember, JobTeamRole } from "@/lib/types/jobDetail";

const ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  owner: {
    label: "Eigenaar",
    cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
  recruiter: {
    label: "Recruiter",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  hiring_manager: {
    label: "Hiring manager",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  interviewer: {
    label: "Interviewer",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  observer: {
    label: "Observer",
    cls: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface JobTeamTabProps {
  jobId: string;
}

export function JobTeamTab({ jobId }: JobTeamTabProps) {
  const { data, isLoading } = useJobTeam(jobId);
  const { data: tenantUsers } = useTenantUsers();
  const addMember = useAddJobTeamMember(jobId);
  const removeMember = useRemoveJobTeamMember(jobId);
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<JobTeamRole>("recruiter");

  const teamUserIds = new Set((data ?? []).map((m) => m.user_id));
  const availableUsers = (tenantUsers ?? []).filter((u) => !teamUserIds.has(u.id));

  const handleAdd = () => {
    if (!selectedUser) return;
    const user = (tenantUsers ?? []).find((u) => u.id === selectedUser);
    if (!user) return;
    addMember.mutate(
      { user_id: selectedUser, role: selectedRole },
      {
        onSuccess: () => {
          toast({
            title: "Lid toegevoegd",
            description: `${user.name} is nu ${ROLE_LABELS[selectedRole]?.label ?? selectedRole}.`,
          });
          setAddOpen(false);
          setSelectedUser("");
          setSelectedRole("recruiter");
        },
      }
    );
  };

  const handleRemove = (member: JobTeamMember) => {
    removeMember.mutate({ userId: member.user_id }, {
      onSuccess: () => {
        toast({
          title: "Lid verwijderd",
          description: `${member.user_name} is uit het team gehaald.`,
        });
      },
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-500" />
              Team
            </CardTitle>
            <CardDescription>
              Recruiters en hiring managers die aan deze vacature werken.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            disabled={availableUsers.length === 0}
          >
            <Plus className="mr-1 h-4 w-4" />
            Lid toevoegen
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (data?.length ?? 0) === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nog geen teamleden toegewezen.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data?.map((member) => {
                const role = ROLE_LABELS[member.role] ?? {
                  label: member.role,
                  cls: "bg-zinc-100 text-zinc-700",
                };
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-indigo-100 text-indigo-700 text-sm font-semibold dark:bg-indigo-950/40 dark:text-indigo-300">
                        {initials(member.user_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {member.user_name}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${role.cls}`}
                        >
                          {role.label}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {member.user_email} · Toegevoegd {formatDate(member.added_at)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(member)}
                      disabled={removeMember.isPending}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`${member.user_name} verwijderen`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ScorecardAgreementSection jobId={jobId} />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Teamlid toevoegen</DialogTitle>
            <DialogDescription>
              Kies een gebruiker en wijs een rol toe voor deze vacature.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Gebruiker</Label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies een gebruiker..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} · {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={selectedRole}
                onValueChange={(v) => setSelectedRole(v as JobTeamRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recruiter">Recruiter</SelectItem>
                  <SelectItem value="hiring_manager">Hiring manager</SelectItem>
                  <SelectItem value="interviewer">Interviewer</SelectItem>
                  <SelectItem value="observer">Observer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Annuleren
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!selectedUser || addMember.isPending}
            >
              Toevoegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScorecardAgreementSection({ jobId }: { jobId: string }) {
  // The agreement matrix only adds value once the team has independent
  // observations. Pick the first application for this job and check whether
  // it has ≥2 scorecards. A future backend endpoint could return the "best
  // candidate" for agreement-comparison in one round-trip; for now we use the
  // first application as a reasonable default.
  const { data: applications } = useApplications(jobId);
  const firstApp = (applications ?? [])[0] ?? null;
  const { data: scorecards } = useScorecardsForApplication(firstApp?.id ?? null);

  const hasAgreement = !!firstApp && (scorecards?.length ?? 0) >= 2;

  if (!hasAgreement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-purple-500" />
            Scorecard-overeenstemming
          </CardTitle>
          <CardDescription>
            Verschijnt zodra minstens twee teamleden onafhankelijk een scorecard
            hebben ingeleverd voor dezelfde kandidaat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nog geen vergelijkbare scorecards.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
        <UserCog className="h-3.5 w-3.5 text-purple-500" />
        Agreement matrix voor{" "}
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">
          {firstApp.candidate_name ?? firstApp.candidate?.name ?? "kandidaat"}
        </span>
      </div>
      <AgreementMatrixView applicationId={firstApp.id} />
    </div>
  );
}
