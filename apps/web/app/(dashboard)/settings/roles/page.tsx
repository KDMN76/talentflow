"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useRoles,
  useCreateRole,
  useDeleteRole,
} from "@/hooks/useSecurity";
import { PermissionMatrixEditor } from "@/components/security/PermissionMatrixEditor";
import {
  RBAC_RESOURCES,
  RBAC_ACTIONS,
  type PermissionGrant,
  type Role,
} from "@/lib/types/security";
import { cn } from "@/lib/utils";

export default function RolesListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data: roles, isLoading } = useRoles();
  const createMutation = useCreateRole();
  const deleteMutation = useDeleteRole();

  const [createOpen, setCreateOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    key: "",
    label: "",
    description: "",
    inherits_from_role_id: null as string | null,
  });
  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);

  const resetForm = () => {
    setStep(1);
    setForm({ key: "", label: "", description: "", inherits_from_role_id: null });
    setPermissions([]);
  };

  const inheritsRole = roles?.find((r) => r.id === form.inherits_from_role_id) ?? null;

  const handleCreate = async () => {
    if (!form.key || !form.label) {
      toast({
        title: "Velden ontbreken",
        description: "Key en label zijn verplicht.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createMutation.mutateAsync({
        key: form.key,
        label: form.label,
        description: form.description || null,
        inherits_from_role_id: form.inherits_from_role_id,
        permissions,
      });
      toast({ title: "Rol aangemaakt" });
      setCreateOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: "Aanmaken mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (role: Role) => {
    if (role.is_system) {
      toast({
        title: "Niet toegestaan",
        description: "System-rollen kunnen niet verwijderd worden.",
        variant: "destructive",
      });
      return;
    }
    if (
      !confirm(
        `Rol "${role.label}" verwijderen? ${
          role.user_count > 0
            ? `Let op: ${role.user_count} gebruiker(s) hebben deze rol.`
            : ""
        }`
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync(role.id);
      toast({ title: "Rol verwijderd" });
    } catch (err) {
      toast({
        title: "Verwijderen mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/settings/security"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Terug naar Security
      </Link>

      <PageHeader
        title="Rollen & rechten"
        description="Beheer system-rollen en maak custom rollen voor specifieke workflows of compliance-eisen."
        actions={
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 border-0"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nieuwe rol
          </Button>
        }
      />

      <Tabs defaultValue="lijst">
        <TabsList>
          <TabsTrigger value="lijst">Rollen</TabsTrigger>
          <TabsTrigger value="matrix">Permission-overzicht</TabsTrigger>
        </TabsList>

        <TabsContent value="lijst" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Laden…
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {roles?.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
                    >
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center shrink-0">
                          <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {r.label}
                            </p>
                            {r.is_system ? (
                              <Badge className="text-[10px] bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0">
                                System
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-0">
                                Custom
                              </Badge>
                            )}
                            <code className="text-[10px] font-mono text-muted-foreground">
                              {r.key}
                            </code>
                          </div>
                          {r.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {r.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground mt-1">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {r.user_count} gebruiker(s)
                            </span>
                            <span>
                              {r.permissions.length} resource(s) gegrant
                            </span>
                            {r.inherits_from_role_id && (
                              <span>
                                erft van{" "}
                                {roles.find(
                                  (x) => x.id === r.inherits_from_role_id
                                )?.label ?? "?"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/settings/roles/${r.id}`)}
                        >
                          {r.is_system ? (
                            <>
                              <Eye className="mr-1.5 h-3.5 w-3.5" />
                              Bekijken
                            </>
                          ) : (
                            <>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              Bewerken
                            </>
                          )}
                        </Button>
                        {!r.is_system && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(r)}
                            disabled={deleteMutation.isPending}
                            className="text-destructive border-destructive/50 hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matrix" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                Permission-overzicht (alle rollen)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Resource</th>
                    <th className="px-3 py-2 text-left font-semibold">Actie</th>
                    {roles?.map((r) => (
                      <th
                        key={r.id}
                        className="px-2 py-2 text-center font-semibold whitespace-nowrap"
                      >
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {RBAC_RESOURCES.flatMap((res) =>
                    RBAC_ACTIONS.map((act) => (
                      <tr key={`${res.key}-${act.key}`}>
                        <td className="px-3 py-1.5 font-medium">
                          {res.label}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {act.label}
                        </td>
                        {roles?.map((r) => {
                          const has = r.permissions
                            .find((p) => p.resource === res.key)
                            ?.actions.includes(act.key);
                          return (
                            <td
                              key={r.id}
                              className="px-2 py-1.5 text-center"
                            >
                              {has ? (
                                <CheckCircle2 className="inline h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <X className="inline h-3 w-3 text-zinc-300" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create-rol wizard */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-600" />
              Nieuwe rol — stap {step} van 2
            </DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Key (technische naam)</Label>
                <Input
                  placeholder="bv. compliance_officer"
                  value={form.key}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      key: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Lowercase, underscores. Niet meer te wijzigen na aanmaken.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Label</Label>
                <Input
                  placeholder="bv. Compliance Officer"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Beschrijving</Label>
                <Textarea
                  rows={3}
                  placeholder="Wat doet deze rol? Wie krijgt 'm?"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Erft van (optioneel)</Label>
                <Select
                  value={form.inherits_from_role_id ?? ""}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      inherits_from_role_id: v || null,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Geen — start vanaf 0" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles ?? [])
                      .filter((r) => r.is_system)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Geërfde rechten worden niet hier opgeslagen, maar ze
                  verschijnen wel als geactiveerd in de matrix.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="py-2 space-y-3">
              <p className="text-xs text-muted-foreground">
                Vink de rechten aan die deze rol direct krijgt. Geërfde rechten
                worden in lichtere kleur weergegeven en kunnen alleen op de
                parent-rol gewijzigd worden.
              </p>
              <PermissionMatrixEditor
                value={permissions}
                onChange={setPermissions}
                inheritsFrom={inheritsRole}
                allRoles={roles ?? []}
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (step === 1) {
                  setCreateOpen(false);
                  resetForm();
                } else {
                  setStep(1);
                }
              }}
            >
              {step === 1 ? "Annuleren" : "Vorige"}
            </Button>
            {step === 1 ? (
              <Button
                onClick={() => setStep(2)}
                disabled={!form.key || !form.label}
                className={cn("bg-indigo-600 hover:bg-indigo-700 border-0")}
              >
                Volgende
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
              >
                {createMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Rol aanmaken
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
