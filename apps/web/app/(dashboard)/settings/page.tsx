"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import {
  Blocks,
  Building2,
  Users,
  Shield,
  Plus,
  Mail,
  Loader2,
  Check,
  Key,
  Webhook,
  Copy,
  Trash2,
  Power,
  Globe,
  Settings2,
  ChevronRight,
  Brain,
  Scale,
  ShieldCheck,
  Palette,
  AtSign,
  Bell,
  Calculator,
  CalendarClock,
  Phone,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { getInitials } from "@/lib/utils";
import { useApiKeys, useCreateApiKey, useRevokeApiKey, type CreatedApiKey } from "@/hooks/useApiKeys";
import {
  useWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
  WEBHOOK_EVENTS,
} from "@/hooks/useWebhooks";
import { useCurrentUser, useTenantUsers } from "@/hooks/useUsers";

// V7: alle settings-subpagina's op één plek vindbaar.
const SETTINGS_SUBPAGES = [
  {
    href: "/settings/security",
    icon: ShieldCheck,
    iconBg: "bg-red-100 dark:bg-red-950/40",
    iconColor: "text-red-600 dark:text-red-400",
    titleKey: "index.subpages.security.title",
    descKey: "index.subpages.security.description",
  },
  {
    href: "/settings/branding",
    icon: Palette,
    iconBg: "bg-pink-100 dark:bg-pink-950/40",
    iconColor: "text-pink-600 dark:text-pink-400",
    titleKey: "index.subpages.branding.title",
    descKey: "index.subpages.branding.description",
  },
  {
    href: "/settings/email",
    icon: Mail,
    iconBg: "bg-blue-100 dark:bg-blue-950/40",
    iconColor: "text-blue-600 dark:text-blue-400",
    titleKey: "index.subpages.email.title",
    descKey: "index.subpages.email.description",
  },
  {
    href: "/settings/modules",
    icon: Blocks,
    iconBg: "bg-violet-100 dark:bg-violet-950/40",
    iconColor: "text-violet-600 dark:text-violet-400",
    titleKey: "index.subpages.modules.title",
    descKey: "index.subpages.modules.description",
  },
  {
    href: "/settings/custom-fields",
    icon: Settings2,
    iconBg: "bg-indigo-100 dark:bg-indigo-950/40",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    titleKey: "index.subpages.customFields.title",
    descKey: "index.subpages.customFields.description",
  },
  {
    href: "/settings/integrations",
    icon: AtSign,
    iconBg: "bg-sky-100 dark:bg-sky-950/40",
    iconColor: "text-sky-600 dark:text-sky-400",
    titleKey: "index.subpages.integrations.title",
    descKey: "index.subpages.integrations.description",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    iconBg: "bg-amber-100 dark:bg-amber-950/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    titleKey: "index.subpages.notifications.title",
    descKey: "index.subpages.notifications.description",
  },
  {
    href: "/settings/talent-fit",
    icon: Brain,
    iconBg: "bg-purple-100 dark:bg-purple-950/40",
    iconColor: "text-purple-600 dark:text-purple-400",
    titleKey: "index.subpages.talentFit.title",
    descKey: "index.subpages.talentFit.description",
  },
  {
    href: "/settings/pay-transparency",
    icon: Scale,
    iconBg: "bg-emerald-100 dark:bg-emerald-950/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    titleKey: "index.subpages.payTransparency.title",
    descKey: "index.subpages.payTransparency.description",
  },
  {
    href: "/settings/accounting",
    icon: Calculator,
    iconBg: "bg-teal-100 dark:bg-teal-950/40",
    iconColor: "text-teal-600 dark:text-teal-400",
    titleKey: "index.subpages.accounting.title",
    descKey: "index.subpages.accounting.description",
  },
  {
    href: "/settings/availability",
    icon: CalendarClock,
    iconBg: "bg-cyan-100 dark:bg-cyan-950/40",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    titleKey: "index.subpages.availability.title",
    descKey: "index.subpages.availability.description",
  },
  {
    href: "/settings/whatsapp",
    icon: MessageSquare,
    iconBg: "bg-green-100 dark:bg-green-950/40",
    iconColor: "text-green-600 dark:text-green-400",
    titleKey: "index.subpages.whatsapp.title",
    descKey: "index.subpages.whatsapp.description",
  },
  {
    href: "/settings/voice",
    icon: Phone,
    iconBg: "bg-orange-100 dark:bg-orange-950/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    titleKey: "index.subpages.voice.title",
    descKey: "index.subpages.voice.description",
  },
] as const;

type SettingsTranslator = ReturnType<typeof useTranslation>["t"];

const makeTenantSchema = (t: SettingsTranslator) =>
  z.object({
    company_name: z.string().min(2, t("index.validation.companyNameRequired")),
    timezone: z.string().min(1, t("index.validation.timezoneRequired")),
  });

const makePasswordSchema = (t: SettingsTranslator) =>
  z
    .object({
      current_password: z.string().min(6),
      new_password: z.string().min(8, t("index.validation.passwordMinLength")),
      confirm_password: z.string(),
    })
    .refine((d) => d.new_password === d.confirm_password, {
      message: t("index.validation.passwordsMismatch"),
      path: ["confirm_password"],
    });

type TenantSchema = ReturnType<typeof makeTenantSchema>;

const roleLabelKeys: Record<string, string> = {
  admin: "index.roles.admin",
  recruiter: "index.roles.recruiter",
  viewer: "index.roles.viewer",
};

const roleColors: Record<string, string> = {
  admin: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400",
  recruiter: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  viewer: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const ALL_PERMISSIONS = [
  { value: "candidates:read", labelKey: "index.permissions.candidatesRead" },
  { value: "candidates:write", labelKey: "index.permissions.candidatesWrite" },
  { value: "jobs:read", labelKey: "index.permissions.jobsRead" },
  { value: "jobs:write", labelKey: "index.permissions.jobsWrite" },
  { value: "pipeline:read", labelKey: "index.permissions.pipelineRead" },
  { value: "pipeline:write", labelKey: "index.permissions.pipelineWrite" },
];

function formatRelativeDate(dateStr: string, t: SettingsTranslator): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t("index.relativeDate.today");
  if (diffDays === 1) return t("index.relativeDate.yesterday");
  if (diffDays < 7) return t("index.relativeDate.daysAgo", { count: diffDays });
  if (diffDays < 30)
    return t("index.relativeDate.weeksAgo", { count: Math.floor(diffDays / 7) });
  if (diffDays < 365)
    return t("index.relativeDate.monthsAgo", { count: Math.floor(diffDays / 30) });
  return t("index.relativeDate.yearsAgo", { count: Math.floor(diffDays / 365) });
}

export default function SettingsPage() {
  const { t } = useTranslation("settingsCore");
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [isSavingTenant, setIsSavingTenant] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Real-data hooks
  const { data: currentUser } = useCurrentUser();
  const {
    data: teamMembers,
    isLoading: teamLoading,
    isError: teamError,
  } = useTenantUsers();

  // API Keys state
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [isCreatedKeyOpen, setIsCreatedKeyOpen] = useState(false);

  // Webhooks state
  const [isCreateWebhookOpen, setIsCreateWebhookOpen] = useState(false);
  const [newWebhookName, setNewWebhookName] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);

  const tenantForm = useForm({
    resolver: zodResolver(makeTenantSchema(t)),
    defaultValues: {
      company_name: currentUser?.tenant?.name ?? "",
      timezone: "Europe/Amsterdam",
    },
    values: currentUser?.tenant?.name
      ? {
          company_name: currentUser.tenant.name,
          timezone: "Europe/Amsterdam",
        }
      : undefined,
  });

  const passwordForm = useForm({
    resolver: zodResolver(makePasswordSchema(t)),
  });

  // API Keys hooks
  const { data: apiKeys, isLoading: keysLoading } = useApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

  // Webhooks hooks
  const { data: webhooks, isLoading: webhooksLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const toggleWebhook = useToggleWebhook();

  const handleSaveTenant = async (data: z.infer<TenantSchema>) => {
    setIsSavingTenant(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsSavingTenant(false);
    toast({
      title: t("index.toasts.tenantSaved.title"),
      description: t("index.toasts.tenantSaved.description"),
    });
  };

  const handleSavePassword = async () => {
    setIsSavingPassword(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsSavingPassword(false);
    passwordForm.reset();
    toast({
      title: t("index.toasts.passwordChanged.title"),
      description: t("index.toasts.passwordChanged.description"),
    });
  };

  const handleInvite = () => {
    if (!inviteEmail) return;
    toast({
      title: t("index.toasts.inviteSent.title"),
      description: t("index.toasts.inviteSent.description", { email: inviteEmail }),
    });
    setInviteEmail("");
  };

  const handleCreateApiKey = async () => {
    if (!newKeyName) return;
    try {
      const result = await createApiKey.mutateAsync({ name: newKeyName, scopes: newKeyPermissions });
      setCreatedKey((result as CreatedApiKey).full_key);
      setIsCreateKeyOpen(false);
      setIsCreatedKeyOpen(true);
      setNewKeyName("");
      setNewKeyPermissions([]);
    } catch {
      toast({
        title: t("index.toasts.keyCreateError.title"),
        description: t("index.toasts.keyCreateError.description"),
        variant: "destructive",
      });
    }
  };

  const handleRevokeKey = async (id: string) => {
    await revokeApiKey.mutateAsync(id);
    toast({
      title: t("index.toasts.keyRevoked.title"),
      description: t("index.toasts.keyRevoked.description"),
    });
  };

  const handleCreateWebhook = async () => {
    if (!newWebhookName || !newWebhookUrl) return;
    try {
      await createWebhook.mutateAsync({
        name: newWebhookName,
        url: newWebhookUrl,
        events: newWebhookEvents,
      });
      setIsCreateWebhookOpen(false);
      setNewWebhookName("");
      setNewWebhookUrl("");
      setNewWebhookEvents([]);
      toast({
        title: t("index.toasts.webhookCreated.title"),
        description: t("index.toasts.webhookCreated.description"),
      });
    } catch {
      toast({
        title: t("index.toasts.webhookCreateError.title"),
        description: t("index.toasts.webhookCreateError.description"),
        variant: "destructive",
      });
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    await deleteWebhook.mutateAsync(id);
    toast({ title: t("index.toasts.webhookDeleted.title") });
  };

  const handleToggleWebhook = async (id: string) => {
    await toggleWebhook.mutateAsync(id);
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      toast({
        title: t("index.toasts.keyCopied.title"),
        description: t("index.toasts.keyCopied.description"),
      });
    }
  };

  const togglePermission = (value: string) => {
    setNewKeyPermissions((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  const toggleWebhookEvent = (value: string) => {
    setNewWebhookEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]
    );
  };

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title={t("index.title")}
        description={t("index.description")}
      />

      {/* Sub-page links — V7: alle settings-subpagina's vindbaar (was 4 van 13) */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0 divide-y divide-border">
          {SETTINGS_SUBPAGES.map((page) => {
            const Icon = page.icon;
            return (
              <Link
                key={page.href}
                href={page.href}
                className="flex items-center gap-3 px-5 py-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors group"
              >
                <div
                  className={`h-9 w-9 rounded-lg flex items-center justify-center ${page.iconBg}`}
                >
                  <Icon className={`h-4 w-4 ${page.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {t(page.titleKey)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t(page.descKey)}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-300 group-hover:text-indigo-500 transition-colors" />
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Tabs defaultValue="algemeen">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="algemeen" className="gap-2">
            <Building2 className="h-3.5 w-3.5" />
            {t("index.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="gebruikers" className="gap-2">
            <Users className="h-3.5 w-3.5" />
            {t("index.tabs.users")}
          </TabsTrigger>
          <TabsTrigger value="beveiliging" className="gap-2">
            <Shield className="h-3.5 w-3.5" />
            {t("index.tabs.security")}
          </TabsTrigger>
          <TabsTrigger value="api-sleutels" className="gap-2">
            <Key className="h-3.5 w-3.5" />
            {t("index.tabs.apiKeys")}
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2">
            <Globe className="h-3.5 w-3.5" />
            {t("index.tabs.webhooks")}
          </TabsTrigger>
        </TabsList>

        {/* Algemeen */}
        <TabsContent value="algemeen" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{t("index.general.title")}</CardTitle>
              <CardDescription>
                {t("index.general.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={tenantForm.handleSubmit(handleSaveTenant)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>{t("index.general.companyNameLabel")}</Label>
                  <Input
                    {...tenantForm.register("company_name")}
                    placeholder={t("index.general.companyNamePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("index.general.timezoneLabel")}</Label>
                  <Input
                    {...tenantForm.register("timezone")}
                    placeholder={t("index.general.timezonePlaceholder")}
                  />
                </div>
                {currentUser?.tenant?.plan && (
                  <div className="space-y-2">
                    <Label>{t("index.general.planLabel")}</Label>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 px-3 py-1 text-sm font-semibold text-white shadow-sm">
                        {currentUser.tenant.plan}
                      </span>
                      <Button variant="link" size="sm" className="text-xs p-0 h-auto">
                        {t("index.general.upgrade")}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSavingTenant}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                  >
                    {isSavingTenant ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {t("index.general.save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Gebruikers */}
        <TabsContent value="gebruikers" className="mt-6 space-y-4">
          {/* Invite */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{t("index.users.inviteTitle")}</CardTitle>
              <CardDescription>
                {t("index.users.inviteDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder={t("index.users.invitePlaceholder")}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="pl-9"
                    onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                  />
                </div>
                <Button
                  onClick={handleInvite}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("index.users.inviteButton")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Team table */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                {teamMembers
                  ? t("index.users.teamTitleCount", { count: teamMembers.length })
                  : t("index.users.teamTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {teamLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("index.users.loading")}
                </div>
              ) : teamError ? (
                <div className="py-8 text-center text-sm text-destructive">
                  {t("index.users.loadError")}
                </div>
              ) : !teamMembers || teamMembers.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("index.users.empty")}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {teamMembers.map((member) => (
                    <Link
                      key={member.id}
                      href={`/settings/users/${member.id}`}
                      className="flex items-center justify-between px-6 py-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-semibold">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {member.name}
                            </p>
                            {member.id === currentUser?.id && (
                              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {t("index.users.you")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {member.email}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                          roleColors[member.role] ?? roleColors.viewer
                        }`}
                      >
                        {roleLabelKeys[member.role]
                          ? t(roleLabelKeys[member.role])
                          : member.role}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Beveiliging */}
        <TabsContent value="beveiliging" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">{t("index.security.title")}</CardTitle>
              <CardDescription>
                {t("index.security.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={passwordForm.handleSubmit(handleSavePassword)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>{t("index.security.currentLabel")}</Label>
                  <Input
                    type="password"
                    placeholder={t("index.security.currentPlaceholder")}
                    {...passwordForm.register("current_password")}
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>{t("index.security.newLabel")}</Label>
                  <Input
                    type="password"
                    placeholder={t("index.security.newPlaceholder")}
                    {...passwordForm.register("new_password")}
                  />
                  {passwordForm.formState.errors.new_password?.message && (
                    <p className="text-xs text-destructive">
                      {String(passwordForm.formState.errors.new_password.message)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t("index.security.confirmLabel")}</Label>
                  <Input
                    type="password"
                    placeholder={t("index.security.confirmPlaceholder")}
                    {...passwordForm.register("confirm_password")}
                  />
                  {passwordForm.formState.errors.confirm_password?.message && (
                    <p className="text-xs text-destructive">
                      {String(passwordForm.formState.errors.confirm_password.message)}
                    </p>
                  )}
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSavingPassword}
                    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
                  >
                    {isSavingPassword ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="mr-2 h-4 w-4" />
                    )}
                    {t("index.security.submit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API-sleutels */}
        <TabsContent value="api-sleutels" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("index.apiKeys.title")}</CardTitle>
                <CardDescription>
                  {t("index.apiKeys.description")}
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => setIsCreateKeyOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 shrink-0"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("index.apiKeys.newKey")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {keysLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t("index.apiKeys.loading")}</div>
              ) : !apiKeys || apiKeys.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("index.apiKeys.empty")}
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border">
                  {apiKeys.map((key) => (
                    <div
                      key={key.id}
                      className="flex items-start justify-between gap-4 px-4 py-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {key.name}
                          </span>
                          {key.permissions.map((perm) => (
                            <Badge
                              key={perm}
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 border-0"
                            >
                              {perm}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs">
                            {key.key_prefix}
                          </span>
                          <span>
                            {t("index.apiKeys.lastUsed")}{" "}
                            {key.last_used_at
                              ? formatRelativeDate(key.last_used_at, t)
                              : t("index.apiKeys.neverUsed")}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRevokeKey(key.id)}
                        disabled={revokeApiKey.isPending}
                        className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        {t("index.apiKeys.revoke")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create API Key Dialog */}
          <Dialog open={isCreateKeyOpen} onOpenChange={setIsCreateKeyOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("index.apiKeys.dialog.title")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="key-name">{t("index.apiKeys.dialog.nameLabel")}</Label>
                  <Input
                    id="key-name"
                    placeholder={t("index.apiKeys.dialog.namePlaceholder")}
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("index.apiKeys.dialog.permissionsLabel")}</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {ALL_PERMISSIONS.map((perm) => (
                      <label
                        key={perm.value}
                        className="flex items-center gap-2.5 cursor-pointer rounded-md px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-indigo-600"
                          checked={newKeyPermissions.includes(perm.value)}
                          onChange={() => togglePermission(perm.value)}
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {t(perm.labelKey)}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {perm.value}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <DialogClose asChild>
                  <Button variant="outline">{t("index.apiKeys.dialog.cancel")}</Button>
                </DialogClose>
                <Button
                  onClick={handleCreateApiKey}
                  disabled={!newKeyName || createApiKey.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {createApiKey.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("index.apiKeys.dialog.create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Created Key Dialog */}
          <Dialog open={isCreatedKeyOpen} onOpenChange={setIsCreatedKeyOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-indigo-600" />
                  {t("index.apiKeys.created.title")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {t("index.apiKeys.created.warning")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{t("index.apiKeys.created.keyLabel")}</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={createdKey ?? ""}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleCopyKey}
                      title={t("index.apiKeys.created.copyTitle")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button
                    className="bg-indigo-600 hover:bg-indigo-700 border-0"
                    onClick={() => setCreatedKey(null)}
                  >
                    {t("index.apiKeys.created.close")}
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Webhooks */}
        <TabsContent value="webhooks" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-base">{t("index.webhooks.title")}</CardTitle>
                <CardDescription>
                  {t("index.webhooks.description")}
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => setIsCreateWebhookOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 shrink-0"
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("index.webhooks.add")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {webhooksLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t("index.webhooks.loading")}</div>
              ) : !webhooks || webhooks.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("index.webhooks.empty")}
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border">
                  {webhooks.map((webhook) => (
                    <div
                      key={webhook.id}
                      className="flex items-start justify-between gap-4 px-4 py-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {webhook.name}
                          </span>
                          {webhook.active ? (
                            <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-0">
                              {t("index.webhooks.active")}
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0"
                            >
                              {t("index.webhooks.inactive")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate max-w-xs">
                          <Globe className="inline h-3 w-3 mr-1 -mt-0.5" />
                          {webhook.url}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {webhook.events.map((eventValue) => {
                            const eventDef = WEBHOOK_EVENTS.find((e) => e.value === eventValue);
                            return (
                              <Badge
                                key={eventValue}
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-400 border-0"
                              >
                                {eventDef?.label ?? eventValue}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleWebhook(webhook.id)}
                          disabled={toggleWebhook.isPending}
                          title={webhook.active ? t("index.webhooks.deactivate") : t("index.webhooks.activate")}
                          className="h-8 w-8 p-0"
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteWebhook(webhook.id)}
                          disabled={deleteWebhook.isPending}
                          className="h-8 w-8 p-0 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Create Webhook Dialog */}
          <Dialog open={isCreateWebhookOpen} onOpenChange={setIsCreateWebhookOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("index.webhooks.dialog.title")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="webhook-name">{t("index.webhooks.dialog.nameLabel")}</Label>
                  <Input
                    id="webhook-name"
                    placeholder={t("index.webhooks.dialog.namePlaceholder")}
                    value={newWebhookName}
                    onChange={(e) => setNewWebhookName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">{t("index.webhooks.dialog.urlLabel")}</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder={t("index.webhooks.dialog.urlPlaceholder")}
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("index.webhooks.dialog.eventsLabel")}</Label>
                  <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {WEBHOOK_EVENTS.map((event) => (
                      <label
                        key={event.value}
                        className="flex items-center gap-2.5 cursor-pointer rounded-md px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded accent-indigo-600"
                          checked={newWebhookEvents.includes(event.value)}
                          onChange={() => toggleWebhookEvent(event.value)}
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">
                          {event.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <DialogClose asChild>
                  <Button variant="outline">{t("index.webhooks.dialog.cancel")}</Button>
                </DialogClose>
                <Button
                  onClick={handleCreateWebhook}
                  disabled={!newWebhookName || !newWebhookUrl || createWebhook.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {createWebhook.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("index.webhooks.dialog.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
