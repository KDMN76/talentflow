"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
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
    title: "Security & toegang",
    description: "SSO/SAML, 2FA, rollen & rechten, IP-allowlist en wachtwoord-beleid.",
  },
  {
    href: "/settings/branding",
    icon: Palette,
    iconBg: "bg-pink-100 dark:bg-pink-950/40",
    iconColor: "text-pink-600 dark:text-pink-400",
    title: "Branding",
    description: "Logo en kleuren van je werkomgeving (white-label).",
  },
  {
    href: "/settings/custom-fields",
    icon: Settings2,
    iconBg: "bg-indigo-100 dark:bg-indigo-950/40",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    title: "Custom velden",
    description: "Definieer extra velden voor kandidaten, vacatures en sollicitaties.",
  },
  {
    href: "/settings/integrations",
    icon: AtSign,
    iconBg: "bg-sky-100 dark:bg-sky-950/40",
    iconColor: "text-sky-600 dark:text-sky-400",
    title: "E-mail-integraties",
    description: "Koppel Gmail of Outlook voor verzenden en synchroniseren vanuit je eigen mailbox.",
  },
  {
    href: "/settings/notifications",
    icon: Bell,
    iconBg: "bg-amber-100 dark:bg-amber-950/40",
    iconColor: "text-amber-600 dark:text-amber-400",
    title: "Notificaties",
    description: "Push-meldingen, voorkeuren per gebeurtenis en stille uren.",
  },
  {
    href: "/settings/talent-fit",
    icon: Brain,
    iconBg: "bg-purple-100 dark:bg-purple-950/40",
    iconColor: "text-purple-600 dark:text-purple-400",
    title: "Talent Fit Model",
    description: "Status, metrics en hertraining van het per-bureau matching-model.",
  },
  {
    href: "/settings/pay-transparency",
    icon: Scale,
    iconBg: "bg-emerald-100 dark:bg-emerald-950/40",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    title: "Pay Transparency",
    description: "EU 2023/970 — salarisbandbreedte, gender-pay-gap rapportage en compliance.",
  },
  {
    href: "/settings/accounting",
    icon: Calculator,
    iconBg: "bg-teal-100 dark:bg-teal-950/40",
    iconColor: "text-teal-600 dark:text-teal-400",
    title: "Boekhouding",
    description: "Koppel Exact Online, Twinfield of SnelStart voor factuur-synchronisatie.",
  },
  {
    href: "/settings/availability",
    icon: CalendarClock,
    iconBg: "bg-cyan-100 dark:bg-cyan-950/40",
    iconColor: "text-cyan-600 dark:text-cyan-400",
    title: "Beschikbaarheid",
    description: "Je werkweek en uitzonderingen voor interview-planning.",
  },
  {
    href: "/settings/whatsapp",
    icon: MessageSquare,
    iconBg: "bg-green-100 dark:bg-green-950/40",
    iconColor: "text-green-600 dark:text-green-400",
    title: "WhatsApp",
    description: "WhatsApp Business-koppeling, templates en opt-in-beheer.",
  },
  {
    href: "/settings/voice",
    icon: Phone,
    iconBg: "bg-orange-100 dark:bg-orange-950/40",
    iconColor: "text-orange-600 dark:text-orange-400",
    title: "Voice",
    description: "Twilio-belintegratie: bellen, opnames en transcripties.",
  },
] as const;

const tenantSchema = z.object({
  company_name: z.string().min(2, "Bedrijfsnaam is verplicht"),
  timezone: z.string().min(1, "Tijdzone is verplicht"),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(6),
    new_password: z.string().min(8, "Minimaal 8 tekens"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Wachtwoorden komen niet overeen",
    path: ["confirm_password"],
  });

const roleLabels: Record<string, string> = {
  admin: "Admin",
  recruiter: "Recruiter",
  viewer: "Bekijker",
};

const roleColors: Record<string, string> = {
  admin: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400",
  recruiter: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  viewer: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const ALL_PERMISSIONS = [
  { value: "candidates:read", label: "Kandidaten lezen" },
  { value: "candidates:write", label: "Kandidaten bewerken" },
  { value: "jobs:read", label: "Vacatures lezen" },
  { value: "jobs:write", label: "Vacatures bewerken" },
  { value: "pipeline:read", label: "Pipeline lezen" },
  { value: "pipeline:write", label: "Pipeline bewerken" },
];

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Vandaag";
  if (diffDays === 1) return "Gisteren";
  if (diffDays < 7) return `${diffDays} dagen geleden`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weken geleden`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} maanden geleden`;
  return `${Math.floor(diffDays / 365)} jaar geleden`;
}

export default function SettingsPage() {
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
    resolver: zodResolver(tenantSchema),
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
    resolver: zodResolver(passwordSchema),
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

  const handleSaveTenant = async (data: z.infer<typeof tenantSchema>) => {
    setIsSavingTenant(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsSavingTenant(false);
    toast({ title: "Instellingen opgeslagen", description: "Bedrijfsinformatie is bijgewerkt." });
  };

  const handleSavePassword = async () => {
    setIsSavingPassword(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsSavingPassword(false);
    passwordForm.reset();
    toast({ title: "Wachtwoord gewijzigd", description: "Je wachtwoord is succesvol bijgewerkt." });
  };

  const handleInvite = () => {
    if (!inviteEmail) return;
    toast({
      title: "Uitnodiging verstuurd",
      description: `${inviteEmail} heeft een uitnodiging ontvangen.`,
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
      toast({ title: "Fout", description: "Kon API-sleutel niet aanmaken.", variant: "destructive" });
    }
  };

  const handleRevokeKey = async (id: string) => {
    await revokeApiKey.mutateAsync(id);
    toast({ title: "API-sleutel ingetrokken", description: "De sleutel is verwijderd." });
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
      toast({ title: "Webhook aangemaakt", description: "De webhook is succesvol opgeslagen." });
    } catch {
      toast({ title: "Fout", description: "Kon webhook niet opslaan.", variant: "destructive" });
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    await deleteWebhook.mutateAsync(id);
    toast({ title: "Webhook verwijderd" });
  };

  const handleToggleWebhook = async (id: string) => {
    await toggleWebhook.mutateAsync(id);
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      toast({ title: "Gekopieerd", description: "API-sleutel is naar het klembord gekopieerd." });
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
        title="Instellingen"
        description="Beheer je account en teaminstellingen"
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
                    {page.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{page.description}</p>
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
            Algemeen
          </TabsTrigger>
          <TabsTrigger value="gebruikers" className="gap-2">
            <Users className="h-3.5 w-3.5" />
            Gebruikers
          </TabsTrigger>
          <TabsTrigger value="beveiliging" className="gap-2">
            <Shield className="h-3.5 w-3.5" />
            Beveiliging
          </TabsTrigger>
          <TabsTrigger value="api-sleutels" className="gap-2">
            <Key className="h-3.5 w-3.5" />
            API-sleutels
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2">
            <Globe className="h-3.5 w-3.5" />
            Webhooks
          </TabsTrigger>
        </TabsList>

        {/* Algemeen */}
        <TabsContent value="algemeen" className="mt-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Bedrijfsinformatie</CardTitle>
              <CardDescription>
                Beheer je bedrijfsnaam en andere algemene instellingen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={tenantForm.handleSubmit(handleSaveTenant)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Bedrijfsnaam</Label>
                  <Input
                    {...tenantForm.register("company_name")}
                    placeholder="Jouw Bedrijf B.V."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tijdzone</Label>
                  <Input
                    {...tenantForm.register("timezone")}
                    placeholder="Europe/Amsterdam"
                  />
                </div>
                {currentUser?.tenant?.plan && (
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 px-3 py-1 text-sm font-semibold text-white shadow-sm">
                        {currentUser.tenant.plan}
                      </span>
                      <Button variant="link" size="sm" className="text-xs p-0 h-auto">
                        Upgraden
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
                    Opslaan
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
              <CardTitle className="text-base">Gebruiker uitnodigen</CardTitle>
              <CardDescription>
                Stuur een uitnodiging naar een nieuw teamlid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="collega@bedrijf.nl"
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
                  Uitnodigen
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Team table */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                Teamleden{teamMembers ? ` (${teamMembers.length})` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {teamLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Bezig met laden...
                </div>
              ) : teamError ? (
                <div className="py-8 text-center text-sm text-destructive">
                  Kon teamleden niet laden — probeer opnieuw.
                </div>
              ) : !teamMembers || teamMembers.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nog geen teamleden — nodig je eerste collega uit hierboven.
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
                                Jij
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
                        {roleLabels[member.role] ?? member.role}
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
              <CardTitle className="text-base">Wachtwoord wijzigen</CardTitle>
              <CardDescription>
                Gebruik een sterk, uniek wachtwoord voor je account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={passwordForm.handleSubmit(handleSavePassword)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Huidig wachtwoord</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    {...passwordForm.register("current_password")}
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Nieuw wachtwoord</Label>
                  <Input
                    type="password"
                    placeholder="Minimaal 8 tekens"
                    {...passwordForm.register("new_password")}
                  />
                  {passwordForm.formState.errors.new_password?.message && (
                    <p className="text-xs text-destructive">
                      {String(passwordForm.formState.errors.new_password.message)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Bevestig nieuw wachtwoord</Label>
                  <Input
                    type="password"
                    placeholder="Herhaal nieuw wachtwoord"
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
                    Wachtwoord wijzigen
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
                <CardTitle className="text-base">API-sleutels</CardTitle>
                <CardDescription>
                  Gebruik API-sleutels om TalentFlow te integreren met externe systemen.
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => setIsCreateKeyOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 shrink-0"
              >
                <Plus className="mr-2 h-4 w-4" />
                Nieuwe sleutel
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {keysLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Laden...</div>
              ) : !apiKeys || apiKeys.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nog geen API-sleutels
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
                            Laatst gebruikt:{" "}
                            {key.last_used_at
                              ? formatRelativeDate(key.last_used_at)
                              : "Nooit gebruikt"}
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
                        Intrekken
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
                <DialogTitle>Nieuwe API-sleutel aanmaken</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="key-name">Naam</Label>
                  <Input
                    id="key-name"
                    placeholder="Bijv. Productie integratie"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rechten</Label>
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
                          {perm.label}
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
                  <Button variant="outline">Annuleren</Button>
                </DialogClose>
                <Button
                  onClick={handleCreateApiKey}
                  disabled={!newKeyName || createApiKey.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {createApiKey.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Aanmaken
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
                  Sleutel aangemaakt
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Bewaar deze sleutel nu. Dit is de enige keer dat je hem ziet.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>API-sleutel</Label>
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
                      title="Kopieer sleutel"
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
                    Sluiten
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
                <CardTitle className="text-base">Webhooks</CardTitle>
                <CardDescription>
                  Stuur real-time notificaties naar externe systemen bij gebeurtenissen in TalentFlow.
                </CardDescription>
              </div>
              <Button
                size="sm"
                onClick={() => setIsCreateWebhookOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 border-0 shrink-0"
              >
                <Plus className="mr-2 h-4 w-4" />
                Webhook toevoegen
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {webhooksLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Laden...</div>
              ) : !webhooks || webhooks.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nog geen webhooks geconfigureerd
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
                              Actief
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border-0"
                            >
                              Inactief
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
                          title={webhook.active ? "Deactiveren" : "Activeren"}
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
                <DialogTitle>Webhook toevoegen</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="webhook-name">Naam</Label>
                  <Input
                    id="webhook-name"
                    placeholder="Bijv. Slack notificaties"
                    value={newWebhookName}
                    onChange={(e) => setNewWebhookName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://..."
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gebeurtenissen</Label>
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
                  <Button variant="outline">Annuleren</Button>
                </DialogClose>
                <Button
                  onClick={handleCreateWebhook}
                  disabled={!newWebhookName || !newWebhookUrl || createWebhook.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {createWebhook.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Opslaan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
