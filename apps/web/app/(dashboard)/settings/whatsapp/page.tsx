"use client";

/**
 * Sprint Q4.6 — WhatsApp Business settings page.
 *
 * - Status card: connection pill, phone, quality-rating, messaging limit,
 *                health-check button. Connect form when disconnected.
 * - Tabs: Templates | Consent | Berichten
 *   - Templates: cards per status pill + "New template" modal (header, body
 *                with {{1}} insertion, footer, buttons, examples).
 *   - Consent: candidate-table with status pills, invite + withdraw actions.
 *   - Berichten: WhatsApp-filtered view of the inbox.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Edit,
  FileText,
  Image as ImageIcon,
  Languages,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { QualityRatingBadge } from "@/components/whatsapp/QualityRatingBadge";
import { ChannelIcon } from "@/components/inbox/ChannelIcon";
import {
  useConnectWhatsApp,
  useCreateTemplate,
  useDeleteTemplate,
  useDisconnectWhatsApp,
  useInviteWhatsAppConsent,
  useSubmitTemplate,
  useUpdateTemplate,
  useWhatsAppConsents,
  useWhatsAppHealthCheck,
  useWhatsAppIntegration,
  useWhatsAppMessages,
  useWhatsAppTemplates,
  useWithdrawWhatsAppConsent,
  type WhatsAppTemplate,
  type WhatsAppTemplateStatus,
  type ConsentStatus,
} from "@/hooks/useWhatsApp";
import { useCandidates } from "@/hooks/useCandidates";

const TEMPLATE_STATUS_PILL: Record<
  WhatsAppTemplateStatus,
  { labelKey: string; className: string }
> = {
  draft: {
    labelKey: "templateStatus.draft",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  },
  submitted: {
    labelKey: "templateStatus.submitted",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40",
  },
  approved: {
    labelKey: "templateStatus.approved",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  },
  rejected: {
    labelKey: "templateStatus.rejected",
    className:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
  },
  paused: {
    labelKey: "templateStatus.paused",
    className:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:ring-orange-900/40",
  },
  disabled: {
    labelKey: "templateStatus.disabled",
    className:
      "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
  },
};

const CONSENT_STATUS_PILL: Record<
  ConsentStatus,
  { labelKey: string; className: string }
> = {
  granted: {
    labelKey: "consentStatus.granted",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  },
  pending: {
    labelKey: "consentStatus.pending",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40",
  },
  withdrawn: {
    labelKey: "consentStatus.withdrawn",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  },
  blocked: {
    labelKey: "consentStatus.blocked",
    className:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
  },
};

export default function WhatsAppSettingsPage() {
  const { t } = useTranslation("settingsWhatsapp");
  const { data: state, isLoading } = useWhatsAppIntegration();
  const integration = state?.integration ?? null;
  const serviceActive = state?.serviceActive ?? true;

  // Eerlijke bevroren-feature-staat: in deze omgeving is WhatsApp niet
  // geactiveerd — geen verbind-formulier dat activatie suggereert.
  if (!isLoading && !serviceActive) {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <NotActivatedCard />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
      />

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : integration?.status === "connected" ? (
        <ConnectedCard integration={integration} />
      ) : (
        <ConnectForm />
      )}

      {integration?.status === "connected" && (
        <Tabs defaultValue="templates" className="space-y-4">
          <TabsList>
            <TabsTrigger value="templates" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> {t("tabs.templates")}
            </TabsTrigger>
            <TabsTrigger value="consent" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" /> {t("tabs.consent")}
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5">
              <MessageCircle className="h-3.5 w-3.5" /> {t("tabs.messages")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="templates">
            <TemplatesTab />
          </TabsContent>
          <TabsContent value="consent">
            <ConsentTab />
          </TabsContent>
          <TabsContent value="messages">
            <MessagesTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Niet geactiveerd ────────────────────────────────────────────────────────

/**
 * Eerlijke staat voor omgevingen waar WhatsApp (nog) niet is geactiveerd.
 * Geen nep-verbindformulier: de feature staat bewust uit.
 */
function NotActivatedCard() {
  const { t } = useTranslation("settingsWhatsapp");
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <MessageCircle className="h-7 w-7 text-zinc-400" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {t("notActivated.title")}
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("notActivated.description")}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Connected card ──────────────────────────────────────────────────────────

function ConnectedCard({
  integration,
}: {
  integration: import("@/lib/types/whatsapp").WhatsAppIntegration;
}) {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const healthCheck = useWhatsAppHealthCheck();
  const disconnect = useDisconnectWhatsApp();

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="grid gap-4 p-6 sm:grid-cols-4">
        <div className="sm:col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {t("connected.connected")}
            </Badge>
            <QualityRatingBadge rating={integration.quality_rating} />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("connected.phoneLabel")}
            </p>
            <p className="font-mono text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {integration.phone_number}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {integration.display_name ?? "—"} · WABA{" "}
              {integration.waba_id ?? "—"}
            </p>
          </div>
        </div>

        <div className="sm:col-span-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("connected.messagingLimitLabel")}
          </p>
          <p className="mt-1 font-mono text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {integration.messaging_limit ?? "—"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("connected.messagingLimitHint")}
          </p>
        </div>

        <div className="flex flex-col items-end justify-between gap-2 sm:col-span-1">
          <p className="text-[11px] text-muted-foreground">
            {t("connected.lastCheck", {
              date: integration.last_health_check_at
                ? new Date(integration.last_health_check_at).toLocaleString("nl-NL", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—",
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                healthCheck.mutate(undefined, {
                  onSuccess: () => toast({ title: t("connected.toasts.healthCheckOk") }),
                })
              }
              disabled={healthCheck.isPending}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", healthCheck.isPending && "animate-spin")}
              />
              {t("connected.healthCheck")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => toast({ title: t("connected.toasts.disconnected") }),
                })
              }
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {t("connected.disconnect")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Connect form ────────────────────────────────────────────────────────────

function ConnectForm() {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const connect = useConnectWhatsApp();
  const [phone, setPhone] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {t("connect.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("connect.descriptionPrefix")}{" "}
              <Link
                href="https://developers.facebook.com/docs/whatsapp"
                target="_blank"
                className="text-indigo-600 hover:underline"
              >
                {t("connect.docLink")}
              </Link>{" "}
              {t("connect.descriptionSuffix")}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone">{t("connect.phoneLabel")}</Label>
            <Input
              id="wa-phone"
              placeholder="+31 6 1234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-waba">{t("connect.wabaLabel")}</Label>
            <Input
              id="wa-waba"
              placeholder="waba_xxxxxxxxxxxxxx"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-key">{t("connect.apiKeyLabel")}</Label>
            <Input
              id="wa-key"
              type="password"
              placeholder="EAA…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-name">{t("connect.displayNameLabel")}</Label>
            <Input
              id="wa-name"
              placeholder="TechRecruit"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() => {
            if (!phone || !apiKey || !wabaId) {
              toast({
                title: t("connect.toasts.requiredTitle"),
                description: t("connect.toasts.requiredDescription"),
                variant: "destructive",
              });
              return;
            }
            connect.mutate(
              {
                phone_number: phone,
                api_key: apiKey,
                waba_id: wabaId,
                display_name: displayName || undefined,
              },
              {
                onSuccess: () =>
                  toast({
                    title: t("connect.toasts.connectedTitle"),
                    description: t("connect.toasts.connectedDescription"),
                  }),
              }
            );
          }}
          disabled={connect.isPending}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          {connect.isPending ? t("connect.submitting") : t("connect.submit")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Templates tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const { t } = useTranslation("settingsWhatsapp");
  const { data: templates, isLoading } = useWhatsAppTemplates();
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("templates.countLine", { count: templates?.length ?? 0 })}
        </p>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("templates.new")}
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates ?? []).map((tpl) => (
            <TemplateCard key={tpl.id} template={tpl} onEdit={() => setEditing(tpl)} />
          ))}
        </div>
      )}
      {(creating || editing) && (
        <TemplateEditor
          template={editing ?? null}
          open={creating || !!editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
}: {
  template: WhatsAppTemplate;
  onEdit: () => void;
}) {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const submit = useSubmitTemplate();
  const del = useDeleteTemplate();
  const pill = TEMPLATE_STATUS_PILL[template.status];

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {template.name}
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Languages className="h-3 w-3" /> {template.language}
              <span>·</span>
              <span className="capitalize">{template.category}</span>
            </div>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
              pill.className
            )}
          >
            {t(pill.labelKey)}
          </span>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border bg-zinc-50/50 p-3 dark:bg-zinc-800/30">
          {template.header?.text && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              {template.header.text}
            </p>
          )}
          <p className="line-clamp-3 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
            {template.body}
          </p>
          {template.footer && (
            <p className="text-[10px] italic text-muted-foreground">
              {template.footer}
            </p>
          )}
          {template.buttons.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {template.buttons.map((b, i) => (
                <span
                  key={i}
                  className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-zinc-900 dark:text-emerald-300"
                >
                  {b.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {template.status === "rejected" && template.rejection_reason && (
          <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50/60 p-2 text-[11px] text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{template.rejection_reason}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {template.status !== "approved" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="h-7 gap-1 text-[11px]"
            >
              <Edit className="h-3 w-3" /> {t("templateCard.edit")}
            </Button>
          )}
          {(template.status === "draft" || template.status === "rejected") && (
            <Button
              size="sm"
              onClick={() =>
                submit.mutate(template.id, {
                  onSuccess: () =>
                    toast({
                      title: t("templateCard.toasts.submittedTitle"),
                      description: t("templateCard.toasts.submittedDescription"),
                    }),
                  onError: () =>
                    toast({
                      title: t("templateCard.toasts.submitErrorTitle"),
                      description: t("templateCard.toasts.submitErrorDescription"),
                      variant: "destructive",
                    }),
                })
              }
              className="h-7 gap-1 text-[11px]"
            >
              <Send className="h-3 w-3" /> {t("templateCard.submit")}
            </Button>
          )}
          {template.status === "submitted" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
              <Sparkles className="h-3 w-3 animate-pulse" /> {t("templateCard.reviewing")}
            </span>
          )}
          {template.status === "draft" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                del.mutate(template.id, {
                  onSuccess: () => toast({ title: t("templateCard.toasts.deletedTitle") }),
                })
              }
              className="ml-auto h-7 px-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
              title={t("templateCard.deleteTitle")}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Template editor modal ───────────────────────────────────────────────────

function TemplateEditor({
  template,
  open,
  onClose,
}: {
  template: WhatsAppTemplate | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [name, setName] = useState(template?.name ?? "");
  const [language, setLanguage] = useState(template?.language ?? "nl");
  const [category, setCategory] = useState<WhatsAppTemplate["category"]>(
    template?.category ?? "utility"
  );
  const [headerType, setHeaderType] = useState<"none" | "text" | "image" | "video" | "document">(
    template?.header ? (template.header.type as "text" | "image" | "video" | "document") : "none"
  );
  const [headerText, setHeaderText] = useState(template?.header?.text ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [footer, setFooter] = useState(template?.footer ?? "");
  const [buttons, setButtons] = useState<WhatsAppTemplate["buttons"]>(
    template?.buttons ?? []
  );
  const [examples, setExamples] = useState<string[]>(
    template?.example_variables ?? []
  );

  // Detect variable placeholders in body
  const variableCount = useMemo(() => {
    const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
    const nums = matches
      .map((m) => parseInt(m.replace(/[^\d]/g, ""), 10))
      .filter((n) => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) : 0;
  }, [body]);

  const insertVariable = () => {
    const next = variableCount + 1;
    setBody((b) => b + `{{${next}}}`);
    setExamples((ex) => [...ex, `voorbeeld${next}`]);
  };

  const addButton = (type: "quick_reply" | "url") => {
    setButtons((bs) => [
      ...bs,
      {
        type,
        text:
          type === "quick_reply"
            ? t("editor.defaultReply")
            : t("editor.defaultUrl"),
        url: type === "url" ? "https://" : undefined,
      },
    ]);
  };

  const removeButton = (i: number) => {
    setButtons((bs) => bs.filter((_, idx) => idx !== i));
  };

  const moveButton = (i: number, dir: -1 | 1) => {
    setButtons((bs) => {
      const next = [...bs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return bs;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!name || !body) {
      toast({
        title: t("editor.toasts.requiredTitle"),
        description: t("editor.toasts.requiredDescription"),
        variant: "destructive",
      });
      return;
    }
    const payload = {
      name,
      language,
      category,
      header:
        headerType === "none"
          ? null
          : { type: headerType, text: headerType === "text" ? headerText : undefined },
      body,
      footer: footer || null,
      buttons,
      example_variables: examples.slice(0, variableCount),
    };
    if (template) {
      await update.mutateAsync({ id: template.id, patch: payload });
      toast({ title: t("editor.toasts.updated") });
    } else {
      await create.mutateAsync(payload);
      toast({ title: t("editor.toasts.savedDraft") });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template
              ? t("editor.editTitle", { name: template.name })
              : t("editor.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Left: form */}
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">{t("editor.nameLabel")}</Label>
                <Input
                  id="t-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="interview_uitnodiging_nl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("editor.languageLabel")}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nl">{t("editor.languages.nl")}</SelectItem>
                    <SelectItem value="en">{t("editor.languages.en")}</SelectItem>
                    <SelectItem value="de">{t("editor.languages.de")}</SelectItem>
                    <SelectItem value="fr">{t("editor.languages.fr")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("editor.categoryLabel")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as WhatsAppTemplate["category"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">{t("editor.categories.utility")}</SelectItem>
                  <SelectItem value="marketing">{t("editor.categories.marketing")}</SelectItem>
                  <SelectItem value="authentication">{t("editor.categories.authentication")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("editor.headerLabel")}</Label>
              <div className="grid grid-cols-5 gap-1">
                {(["none", "text", "image", "video", "document"] as const).map(
                  (h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHeaderType(h)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        headerType === h
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-border text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                      )}
                    >
                      {t(`editor.headerTypes.${h}`)}
                    </button>
                  )
                )}
              </div>
              {headerType === "text" && (
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("editor.headerTextPlaceholder")}
                  maxLength={60}
                />
              )}
              {headerType !== "none" && headerType !== "text" && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {headerType === "image" && <ImageIcon className="h-3 w-3" />}
                  {headerType === "video" && <Video className="h-3 w-3" />}
                  {headerType === "document" && <FileText className="h-3 w-3" />}
                  {t("editor.headerUploadHint", { type: headerType })}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="t-body">{t("editor.bodyLabel")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={insertVariable}
                  className="h-6 gap-1 text-[10px]"
                >
                  <Plus className="h-3 w-3" /> {t("editor.variableButton")} {`{{${variableCount + 1}}}`}
                </Button>
              </div>
              <Textarea
                id="t-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("editor.bodyPlaceholder", { token: "{{1}}" })}
                className="min-h-[120px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-footer">{t("editor.footerLabel")}</Label>
              <Input
                id="t-footer"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="TechRecruit B.V."
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{t("editor.buttonsLabel")}</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addButton("quick_reply")}
                    disabled={buttons.length >= 3}
                    className="h-6 gap-1 text-[10px]"
                  >
                    <Plus className="h-3 w-3" /> {t("editor.addReply")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addButton("url")}
                    disabled={buttons.length >= 3}
                    className="h-6 gap-1 text-[10px]"
                  >
                    <Plus className="h-3 w-3" /> {t("editor.addUrl")}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                {buttons.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-white p-1.5 dark:bg-zinc-900"
                  >
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {b.type === "url" ? t("editor.typeLink") : t("editor.typeReply")}
                    </span>
                    <Input
                      value={b.text}
                      onChange={(e) =>
                        setButtons((bs) =>
                          bs.map((x, idx) =>
                            idx === i ? { ...x, text: e.target.value } : x
                          )
                        )
                      }
                      className="h-7 flex-1 text-xs"
                    />
                    {b.type === "url" && (
                      <Input
                        value={b.url ?? ""}
                        onChange={(e) =>
                          setButtons((bs) =>
                            bs.map((x, idx) =>
                              idx === i ? { ...x, url: e.target.value } : x
                            )
                          )
                        }
                        placeholder="https://"
                        className="h-7 flex-1 text-xs"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => moveButton(i, -1)}
                      className="rounded p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      aria-label={t("editor.moveUp")}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveButton(i, 1)}
                      className="rounded p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      aria-label={t("editor.moveDown")}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeButton(i)}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {variableCount > 0 && (
              <div className="space-y-1.5">
                <Label>{t("editor.examplesLabel")}</Label>
                <div className="space-y-1">
                  {Array.from({ length: variableCount }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {`{{${i + 1}}}`}
                      </span>
                      <Input
                        value={examples[i] ?? ""}
                        onChange={(e) =>
                          setExamples((ex) => {
                            const next = [...ex];
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        className="h-7 flex-1 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: preview */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("editor.previewLabel")}
            </p>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
              {headerType === "text" && headerText && (
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  {headerText}
                </p>
              )}
              {headerType === "image" && (
                <div className="mb-2 flex h-24 w-full items-center justify-center rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
                {body || (
                  <span className="text-muted-foreground">
                    {t("editor.bodyPreviewPlaceholder")}
                  </span>
                )}
              </p>
              {footer && (
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  {footer}
                </p>
              )}
              {buttons.length > 0 && (
                <div className="mt-3 space-y-1">
                  {buttons.map((b, i) => (
                    <div
                      key={i}
                      className="rounded border border-emerald-200 bg-white px-2 py-1.5 text-center text-xs font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-zinc-900 dark:text-emerald-300"
                    >
                      {b.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-2 text-[10px] italic text-muted-foreground">
              {t("editor.previewNote")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
            {template ? t("editor.save") : t("editor.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Consent tab ─────────────────────────────────────────────────────────────

function ConsentTab() {
  const { t } = useTranslation("settingsWhatsapp");
  const { data: consents, isLoading } = useWhatsAppConsents();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState<{
    candidate_id: string;
    candidate_name?: string;
  } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("consent.countLine", { count: consents?.length ?? 0 })}
        </p>
        <Button onClick={() => setInviteOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> {t("consent.invite")}
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-zinc-800/40">
                  <tr>
                    <th className="px-4 py-2">{t("consent.table.candidate")}</th>
                    <th className="px-4 py-2">{t("consent.table.phone")}</th>
                    <th className="px-4 py-2">{t("consent.table.status")}</th>
                    <th className="px-4 py-2">{t("consent.table.source")}</th>
                    <th className="px-4 py-2">{t("consent.table.since")}</th>
                    <th className="px-4 py-2 text-right">{t("consent.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(consents ?? []).map((c) => {
                    const pill = CONSENT_STATUS_PILL[c.status];
                    return (
                      <tr key={c.id}>
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/candidates/${c.candidate_id}`}
                            className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100"
                          >
                            {c.candidate_name ?? c.candidate_id}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {c.phone_number}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                              pill.className
                            )}
                          >
                            {t(pill.labelKey)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {c.opt_in_source ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {c.granted_at
                            ? new Date(c.granted_at).toLocaleDateString("nl-NL", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {c.status === "granted" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setWithdrawing({
                                  candidate_id: c.candidate_id,
                                  candidate_name: c.candidate_name,
                                })
                              }
                              className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                            >
                              {t("consent.withdraw")}
                            </Button>
                          )}
                          {(c.status === "pending" || c.status === "withdrawn") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setInviteOpen(true)}
                              className="h-7 text-xs"
                            >
                              {t("consent.reinvite")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {inviteOpen && <InviteConsentDialog onClose={() => setInviteOpen(false)} />}
      {withdrawing && (
        <WithdrawConsentDialog
          candidateId={withdrawing.candidate_id}
          candidateName={withdrawing.candidate_name}
          onClose={() => setWithdrawing(null)}
        />
      )}
    </div>
  );
}

function InviteConsentDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const invite = useInviteWhatsAppConsent();
  const [candidateId, setCandidateId] = useState("");
  const [phone, setPhone] = useState("");
  const { data: candidates, isLoading: candidatesLoading } = useCandidates();

  const candidate = (candidates ?? []).find((c) => c.id === candidateId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("invite.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("invite.candidateLabel")}</Label>
            <Select value={candidateId} onValueChange={(v) => {
              setCandidateId(v);
              const c = (candidates ?? []).find((x) => x.id === v);
              setPhone(c?.phone ?? "");
            }}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    candidatesLoading
                      ? t("invite.candidatesLoading")
                      : !candidates || candidates.length === 0
                        ? t("invite.noCandidates")
                        : t("invite.selectCandidate")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(candidates ?? []).slice(0, 20).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-phone">{t("invite.phoneLabel")}</Label>
            <Input
              id="invite-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+31 6 1234 5678"
            />
          </div>
          {/* Eerlijke uitleg: TalentFlow maakt een persoonlijke opt-in link
              aan maar verstuurt die (nog) niet automatisch. De oude UI
              suggereerde een verzonden WhatsApp/e-mail die nooit bestond. */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-zinc-50/70 p-3 dark:bg-zinc-800/40">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("invite.info")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("invite.cancel")}
          </Button>
          <Button
            disabled={!candidateId || !phone || invite.isPending}
            onClick={async () => {
              try {
                const result = await invite.mutateAsync({
                  candidate_id: candidateId,
                  phone_number: phone,
                  candidate_name: candidate?.name,
                });
                let copied = false;
                try {
                  await navigator.clipboard.writeText(result.token_url);
                  copied = true;
                } catch {
                  /* clipboard niet beschikbaar — link staat in de toast */
                }
                toast({
                  title: t("invite.toasts.createdTitle"),
                  description: copied
                    ? t("invite.toasts.createdCopied")
                    : t("invite.toasts.createdShare", { url: result.token_url }),
                });
                onClose();
              } catch {
                toast({
                  title: t("invite.toasts.errorTitle"),
                  description: t("invite.toasts.errorDescription"),
                  variant: "destructive",
                });
              }
            }}
          >
            {invite.isPending ? t("invite.submitting") : t("invite.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawConsentDialog({
  candidateId,
  candidateName,
  onClose,
}: {
  candidateId: string;
  candidateName?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("settingsWhatsapp");
  const { toast } = useToast();
  const withdraw = useWithdrawWhatsAppConsent();
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("withdraw.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("withdraw.descriptionPrefix")}
          <strong>{candidateName ?? candidateId}</strong>
          {t("withdraw.descriptionSuffix")}
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("withdraw.reasonPlaceholder")}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("withdraw.cancel")}
          </Button>
          <Button
            disabled={!reason.trim()}
            variant="destructive"
            onClick={async () => {
              await withdraw.mutateAsync({
                candidate_id: candidateId,
                reason: reason.trim(),
              });
              toast({ title: t("withdraw.toast") });
              onClose();
            }}
          >
            {t("withdraw.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Messages tab ────────────────────────────────────────────────────────────

function MessagesTab() {
  const { t } = useTranslation("settingsWhatsapp");
  const { data: messages, isLoading } = useWhatsAppMessages();
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : !messages || messages.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t("messages.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {messages.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                <ChannelIcon channel="whatsapp" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {m.candidate_name ?? m.candidate_id}
                    </span>
                    <span className="text-muted-foreground">
                      {m.direction === "outbound" ? t("messages.sent") : t("messages.received")} ·{" "}
                      {new Date(m.created_at).toLocaleString("nl-NL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <span
                      className={cn(
                        "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        m.status === "read" &&
                          "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
                        m.status === "delivered" &&
                          "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
                        m.status === "sent" &&
                          "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                        m.status === "failed" &&
                          "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400",
                        m.status === "received" &&
                          "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                      )}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-700 dark:text-zinc-300">
                    {m.body_text ?? "(media)"}
                  </p>
                  {m.error_message && (
                    <p className="mt-0.5 text-[10px] text-red-600">
                      {m.error_message}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
