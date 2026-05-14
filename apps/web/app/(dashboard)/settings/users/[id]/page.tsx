"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import {
  useRoles,
  useUserRoles,
  useAssignRole,
  useUnassignRole,
} from "@/hooks/useSecurity";
import { mockTeamMembers } from "@/lib/mockData";
import { getInitials } from "@/lib/utils";

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params?.id;
  const { toast } = useToast();
  const { data: roles } = useRoles();
  const { data: userRoles, isLoading } = useUserRoles(userId);
  const assignMutation = useAssignRole();
  const unassignMutation = useUnassignRole();

  const [selectedRole, setSelectedRole] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");

  const member =
    mockTeamMembers.find((m) => m.id === userId) ?? {
      id: userId ?? "?",
      name: "Onbekende gebruiker",
      email: "—",
      role: "viewer",
    };

  const handleAssign = async () => {
    if (!userId || !selectedRole) return;
    if ((userRoles ?? []).some((a) => a.role_id === selectedRole)) {
      toast({
        title: "Al toegewezen",
        description: "Deze rol heeft de gebruiker al.",
        variant: "destructive",
      });
      return;
    }
    await assignMutation.mutateAsync({
      user_id: userId,
      role_id: selectedRole,
      expires_at: expiresAt || null,
    });
    setSelectedRole("");
    setExpiresAt("");
    toast({ title: "Rol toegewezen" });
  };

  const handleUnassign = async (id: string) => {
    if (!confirm("Rol verwijderen?")) return;
    await unassignMutation.mutateAsync(id);
    toast({ title: "Rol verwijderd" });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Terug naar Instellingen
      </Link>

      <PageHeader title={member.name} description={member.email} />

      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-semibold">
              {getInitials(member.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{member.name}</p>
            <p className="text-xs text-muted-foreground">{member.email}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600" />
            Rollen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current roles as chips */}
          <div className="space-y-2">
            <Label className="text-xs">Huidige rollen</Label>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Laden…</p>
            ) : !userRoles?.length ? (
              <p className="text-sm text-muted-foreground">
                Nog geen rollen toegewezen.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {userRoles.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-300"
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {a.role_label}
                    {a.expires_at && (
                      <span className="text-[10px] text-muted-foreground">
                        verloopt{" "}
                        {new Date(a.expires_at).toLocaleDateString("nl-NL")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleUnassign(a.id)}
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      title="Verwijderen"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Assign new */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 pt-3 border-t border-border">
            <div className="space-y-1">
              <Label className="text-xs">Rol toevoegen</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies rol…" />
                </SelectTrigger>
                <SelectContent>
                  {(roles ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                      {r.is_system && (
                        <span className="text-[10px] text-muted-foreground ml-2">
                          (system)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Verloopt op (optioneel)</Label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleAssign}
                disabled={!selectedRole || assignMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 w-full"
              >
                {assignMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Toewijzen
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
