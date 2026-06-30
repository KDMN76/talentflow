"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settingsAccess");
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
        title: t("rolesList.toasts.fieldsMissing.title"),
        description: t("rolesList.toasts.fieldsMissing.description"),
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
      toast({ title: t("rolesList.toasts.created.title") });
      setCreateOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: t("rolesList.toasts.createError.title"),
        description:
          err instanceof Error
            ? err.message
            : t("rolesList.toasts.createError.fallback"),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (role: Role) => {
    if (role.is_system) {
      toast({
        title: t("rolesList.toasts.notAllowed.title"),
        description: t("rolesList.toasts.notAllowed.description"),
        variant: "destructive",
      });
      return;
    }
    if (
      !confirm(
        t("rolesList.confirmDelete", {
          label: role.label,
          warning:
            role.user_count > 0
              ? t("rolesList.confirmDeleteWarning", { count: role.user_count })
              : "",
        })
      )
    )
      return;
    try {
      await deleteMutation.mutateAsync(role.id);
      toast({ title: t("rolesList.toasts.deleted.title") });
    } catch (err) {
      toast({
        title: t("rolesList.toasts.deleteError.title"),
        description:
          err instanceof Error
            ? err.message
            : t("rolesList.toasts.deleteError.fallback"),
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
        {t("rolesList.backToSecurity")}
      </Link>

      <PageHeader
        title={t("rolesList.title")}
        description={t("rolesList.description")}
        actions={
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 border-0"
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("rolesList.newRole")}
          </Button>
        }
      />

      <Tabs defaultValue="lijst">
        <TabsList>
          <TabsTrigger value="lijst">{t("rolesList.tabs.list")}</TabsTrigger>
          <TabsTrigger value="matrix">{t("rolesList.tabs.matrix")}</TabsTrigger>
        </TabsList>

        <TabsContent value="lijst" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {t("rolesList.loading")}
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
                                {t("rolesList.badge.system")}
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-0">
                                {t("rolesList.badge.custom")}
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
                              {t("rolesList.userCount", {
                                count: r.user_count,
                              })}
                            </span>
                            <span>
                              {t("rolesList.resourcesGranted", {
                                count: r.permissions.length,
                              })}
                            </span>
                            {r.inherits_from_role_id && (
                              <span>
                                {t("rolesList.inheritsFrom", {
                                  label:
                                    roles.find(
                                      (x) => x.id === r.inherits_from_role_id
                                    )?.label ??
                                    t("rolesList.inheritsFromUnknown"),
                                })}
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
                              {t("rolesList.view")}
                            </>
                          ) : (
                            <>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />
                              {t("rolesList.edit")}
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
                {t("rolesList.matrix.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-900/40 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">
                      {t("rolesList.matrix.resource")}
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      {t("rolesList.matrix.action")}
                    </th>
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
                          // De backend levert permissions als matrix
                          // {resource:{action:bool}}, niet als PermissionGrant[]
                          // (zoals het type suggereert). Ondersteun beide shapes
                          // zodat de pagina niet crasht op `.find`.
                          const perms = r.permissions as unknown;
                          const has = Array.isArray(perms)
                            ? perms
                                .find(
                                  (p: { resource: string; actions: string[] }) =>
                                    p.resource === res.key
                                )
                                ?.actions.includes(act.key)
                            : Boolean(
                                (
                                  perms as
                                    | Record<string, Record<string, boolean>>
                                    | null
                                    | undefined
                                )?.[res.key]?.[act.key]
                              );
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
              {t("rolesList.wizard.title", { step })}
            </DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("rolesList.wizard.keyLabel")}</Label>
                <Input
                  placeholder={t("rolesList.wizard.keyPlaceholder")}
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
                  {t("rolesList.wizard.keyHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t("rolesList.wizard.labelLabel")}</Label>
                <Input
                  placeholder={t("rolesList.wizard.labelPlaceholder")}
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("rolesList.wizard.descriptionLabel")}</Label>
                <Textarea
                  rows={3}
                  placeholder={t("rolesList.wizard.descriptionPlaceholder")}
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("rolesList.wizard.inheritsLabel")}</Label>
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
                    <SelectValue
                      placeholder={t("rolesList.wizard.inheritsPlaceholder")}
                    />
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
                  {t("rolesList.wizard.inheritsHint")}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="py-2 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("rolesList.wizard.step2Hint")}
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
              {step === 1
                ? t("rolesList.wizard.cancel")
                : t("rolesList.wizard.previous")}
            </Button>
            {step === 1 ? (
              <Button
                onClick={() => setStep(2)}
                disabled={!form.key || !form.label}
                className={cn("bg-indigo-600 hover:bg-indigo-700 border-0")}
              >
                {t("rolesList.wizard.next")}
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
                {t("rolesList.wizard.createRole")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
