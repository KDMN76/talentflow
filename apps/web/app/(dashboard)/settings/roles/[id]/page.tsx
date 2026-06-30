"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Lock,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  useRole,
  useRoles,
  useUpdateRole,
  useDeleteRole,
  useRoleAssignments,
  useUnassignRole,
} from "@/hooks/useSecurity";
import { PermissionMatrixEditor } from "@/components/security/PermissionMatrixEditor";
import type { PermissionGrant } from "@/lib/types/security";
import { getInitials } from "@/lib/utils";

export default function RoleDetailPage() {
  const { t } = useTranslation("settingsAccess");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const id = params?.id;
  const { data: role, isLoading } = useRole(id);
  const { data: allRoles } = useRoles();
  const { data: assignments } = useRoleAssignments(id);
  const updateMutation = useUpdateRole();
  const deleteMutation = useDeleteRole();
  const unassignMutation = useUnassignRole();

  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [inheritsId, setInheritsId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionGrant[]>([]);

  useEffect(() => {
    if (role) {
      setLabel(role.label);
      setDescription(role.description ?? "");
      setInheritsId(role.inherits_from_role_id);
      setPermissions(role.permissions);
    }
  }, [role]);

  const inheritsRole =
    allRoles?.find((r) => r.id === inheritsId) ?? null;

  const isReadOnly = !!role?.is_system;

  const handleSave = async () => {
    if (!role) return;
    try {
      await updateMutation.mutateAsync({
        id: role.id,
        label,
        description: description || null,
        inherits_from_role_id: inheritsId,
        permissions,
      });
      toast({ title: t("roleDetail.toasts.updated.title") });
    } catch (err) {
      toast({
        title: t("roleDetail.toasts.updateError.title"),
        description:
          err instanceof Error
            ? err.message
            : t("roleDetail.toasts.updateError.fallback"),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!role) return;
    if (!confirm(t("roleDetail.confirmDelete", { label: role.label }))) return;
    try {
      await deleteMutation.mutateAsync(role.id);
      toast({ title: t("roleDetail.toasts.deleted.title") });
      router.push("/settings/roles");
    } catch (err) {
      toast({
        title: t("roleDetail.toasts.deleteError.title"),
        description:
          err instanceof Error
            ? err.message
            : t("roleDetail.toasts.deleteError.fallback"),
        variant: "destructive",
      });
    }
  };

  const handleUnassign = async (assignmentId: string) => {
    if (!confirm(t("roleDetail.confirmUnassign"))) return;
    await unassignMutation.mutateAsync(assignmentId);
    toast({ title: t("roleDetail.toasts.unassigned.title") });
  };

  if (isLoading || !role) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("roleDetail.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/settings/roles"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        {t("roleDetail.backToRoles")}
      </Link>

      <PageHeader
        title={role.label}
        description={
          role.is_system
            ? t("roleDetail.descriptionSystem")
            : t("roleDetail.descriptionCustom")
        }
        actions={
          <div className="flex items-center gap-2">
            {role.is_system ? (
              <Badge className="text-[10px] bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0 gap-1">
                <Lock className="h-3 w-3" />
                {t("roleDetail.badge.system")}
              </Badge>
            ) : (
              <Badge className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-0">
                {t("roleDetail.badge.custom")}
              </Badge>
            )}
            <code className="text-[10px] font-mono text-muted-foreground">
              {role.key}
            </code>
          </div>
        }
      />

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">
            {t("roleDetail.tabs.config")}
          </TabsTrigger>
          <TabsTrigger value="permissions">
            {t("roleDetail.tabs.permissions")}
          </TabsTrigger>
          <TabsTrigger value="users">
            {t("roleDetail.tabs.users", {
              count: assignments?.length ?? 0,
            })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-2">
                <Label>{t("roleDetail.labelLabel")}</Label>
                <Input
                  disabled={isReadOnly}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("roleDetail.descriptionLabel")}</Label>
                <Textarea
                  rows={3}
                  disabled={isReadOnly}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("roleDetail.inheritsLabel")}</Label>
                <Select
                  disabled={isReadOnly}
                  value={inheritsId ?? ""}
                  onValueChange={(v) => setInheritsId(v || null)}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("roleDetail.inheritsPlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(allRoles ?? [])
                      .filter((r) => r.is_system && r.id !== role.id)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {!isReadOnly && (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("roleDetail.delete")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("roleDetail.saveChanges")}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="permissions" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                {t("roleDetail.permissionMatrixTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PermissionMatrixEditor
                value={permissions}
                onChange={isReadOnly ? undefined : setPermissions}
                readOnly={isReadOnly}
                inheritsFrom={inheritsRole}
                allRoles={allRoles ?? []}
              />
            </CardContent>
          </Card>
          {!isReadOnly && (
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 border-0"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t("roleDetail.savePermissions")}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              {!assignments || assignments.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <Users className="mx-auto h-10 w-10 text-zinc-300 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {t("roleDetail.noUsersTitle")}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {assignments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-4 px-5 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-xs font-semibold">
                            {getInitials(a.user_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{a.user_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.user_email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {a.expires_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {t("roleDetail.expiresOn", {
                              date: new Date(
                                a.expires_at
                              ).toLocaleDateString("nl-NL"),
                            })}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUnassign(a.id)}
                          disabled={unassignMutation.isPending}
                          className="text-destructive border-destructive/50 hover:bg-destructive/10"
                        >
                          <X className="h-3.5 w-3.5 mr-1.5" />
                          {t("roleDetail.removeAssignment")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
