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
  { label: string; className: string }
> = {
  draft: {
    label: "Concept",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  },
  submitted: {
    label: "Wacht op goedkeuring",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40",
  },
  approved: {
    label: "Goedgekeurd",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  },
  rejected: {
    label: "Afgewezen",
    className:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
  },
  paused: {
    label: "Gepauzeerd",
    className:
      "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:ring-orange-900/40",
  },
  disabled: {
    label: "Uitgeschakeld",
    className:
      "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
  },
};

const CONSENT_STATUS_PILL: Record<
  ConsentStatus,
  { label: string; className: string }
> = {
  granted: {
    label: "Toestemming",
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  },
  pending: {
    label: "In afwachting",
    className:
      "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/40",
  },
  withdrawn: {
    label: "Ingetrokken",
    className:
      "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  },
  blocked: {
    label: "Geblokkeerd",
    className:
      "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
  },
};

export default function WhatsAppSettingsPage() {
  const { data: integration, isLoading } = useWhatsAppIntegration();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="WhatsApp Business"
        description="Beheer je WhatsApp-integratie, templates en kandidaat-toestemmingen."
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
              <FileText className="h-3.5 w-3.5" /> Templates
            </TabsTrigger>
            <TabsTrigger value="consent" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" /> Consent
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-1.5">
              <MessageCircle className="h-3.5 w-3.5" /> Berichten
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

// ─── Connected card ──────────────────────────────────────────────────────────

function ConnectedCard({
  integration,
}: {
  integration: import("@/lib/types/whatsapp").WhatsAppIntegration;
}) {
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
              Verbonden
            </Badge>
            <QualityRatingBadge rating={integration.quality_rating} />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Telefoonnummer
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
            Messaging-limiet
          </p>
          <p className="mt-1 font-mono text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {integration.messaging_limit ?? "—"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Verhoogt automatisch bij goede quality-rating.
          </p>
        </div>

        <div className="flex flex-col items-end justify-between gap-2 sm:col-span-1">
          <p className="text-[11px] text-muted-foreground">
            Laatste check:{" "}
            {integration.last_health_check_at
              ? new Date(integration.last_health_check_at).toLocaleString("nl-NL", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "—"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                healthCheck.mutate(undefined, {
                  onSuccess: () => toast({ title: "Health-check geslaagd" }),
                })
              }
              disabled={healthCheck.isPending}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", healthCheck.isPending && "animate-spin")}
              />
              Health-check
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                disconnect.mutate(undefined, {
                  onSuccess: () => toast({ title: "Verbinding verbroken" }),
                })
              }
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              Ontkoppelen
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Connect form ────────────────────────────────────────────────────────────

function ConnectForm() {
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
              Verbind je WhatsApp Business-account
            </h2>
            <p className="text-xs text-muted-foreground">
              Voer je Meta WhatsApp Business API-credentials in. Zie{" "}
              <Link
                href="https://developers.facebook.com/docs/whatsapp"
                target="_blank"
                className="text-indigo-600 hover:underline"
              >
                Meta-documentatie
              </Link>{" "}
              voor hoe je je WABA-ID en API-key vindt.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone">Telefoonnummer</Label>
            <Input
              id="wa-phone"
              placeholder="+31 6 1234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-waba">WABA-ID</Label>
            <Input
              id="wa-waba"
              placeholder="waba_xxxxxxxxxxxxxx"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-key">API-key</Label>
            <Input
              id="wa-key"
              type="password"
              placeholder="EAA…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-name">Weergavenaam (optioneel)</Label>
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
                title: "Verplichte velden",
                description: "Vul telefoonnummer, WABA-ID en API-key in.",
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
                    title: "Verbonden",
                    description: "WhatsApp Business is nu actief.",
                  }),
              }
            );
          }}
          disabled={connect.isPending}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          {connect.isPending ? "Verbinden…" : "Verbinden"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Templates tab ───────────────────────────────────────────────────────────

function TemplatesTab() {
  const { data: templates, isLoading } = useWhatsAppTemplates();
  const [editing, setEditing] = useState<WhatsAppTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {templates?.length ?? 0} templates · Meta keurt goed binnen ~5min — in
          mock-mode 4s.
        </p>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nieuwe template
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
          {(templates ?? []).map((t) => (
            <TemplateCard key={t.id} template={t} onEdit={() => setEditing(t)} />
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
            {pill.label}
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
              <Edit className="h-3 w-3" /> Bewerken
            </Button>
          )}
          {(template.status === "draft" || template.status === "rejected") && (
            <Button
              size="sm"
              onClick={() =>
                submit.mutate(template.id, {
                  onSuccess: () =>
                    toast({
                      title: "Ingediend",
                      description: "Meta beoordeelt nu — duurt ~5min.",
                    }),
                })
              }
              className="h-7 gap-1 text-[11px]"
            >
              <Send className="h-3 w-3" /> Verzenden ter goedkeuring
            </Button>
          )}
          {template.status === "submitted" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
              <Sparkles className="h-3 w-3 animate-pulse" /> Meta beoordeelt…
            </span>
          )}
          {template.status === "draft" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                del.mutate(template.id, {
                  onSuccess: () => toast({ title: "Verwijderd" }),
                })
              }
              className="ml-auto h-7 px-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
              title="Verwijderen"
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
        text: type === "quick_reply" ? "Snel antwoord" : "Open link",
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
        title: "Verplichte velden",
        description: "Naam en body zijn verplicht.",
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
      toast({ title: "Template bijgewerkt" });
    } else {
      await create.mutateAsync(payload);
      toast({ title: "Template opgeslagen als concept" });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template ? `Template bewerken: ${template.name}` : "Nieuwe template"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Left: form */}
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Naam</Label>
                <Input
                  id="t-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="interview_uitnodiging_nl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Taal</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nl">Nederlands</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Categorie</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as WhatsAppTemplate["category"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utility">Utility (transactioneel)</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="authentication">Authentication</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Header</Label>
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
                      {h === "none"
                        ? "Geen"
                        : h.charAt(0).toUpperCase() + h.slice(1)}
                    </button>
                  )
                )}
              </div>
              {headerType === "text" && (
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder="Header tekst (max 60 tekens)"
                  maxLength={60}
                />
              )}
              {headerType !== "none" && headerType !== "text" && (
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {headerType === "image" && <ImageIcon className="h-3 w-3" />}
                  {headerType === "video" && <Video className="h-3 w-3" />}
                  {headerType === "document" && <FileText className="h-3 w-3" />}
                  Bij verzenden upload je een {headerType}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="t-body">Body</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={insertVariable}
                  className="h-6 gap-1 text-[10px]"
                >
                  <Plus className="h-3 w-3" /> Variabele {`{{${variableCount + 1}}}`}
                </Button>
              </div>
              <Textarea
                id="t-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hoi {{1}}, …"
                className="min-h-[120px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-footer">Footer (optioneel)</Label>
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
                <Label>Knoppen (max 3)</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addButton("quick_reply")}
                    disabled={buttons.length >= 3}
                    className="h-6 gap-1 text-[10px]"
                  >
                    <Plus className="h-3 w-3" /> Antwoord
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addButton("url")}
                    disabled={buttons.length >= 3}
                    className="h-6 gap-1 text-[10px]"
                  >
                    <Plus className="h-3 w-3" /> Link
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
                      {b.type === "url" ? "link" : "antwoord"}
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
                      aria-label="Omhoog"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveButton(i, 1)}
                      className="rounded p-1 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      aria-label="Omlaag"
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
                <Label>Voorbeelden voor variabelen</Label>
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
              Voorbeeld
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
                    De body verschijnt hier.
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
              Voorbeeldweergave zoals WhatsApp die toont op een telefoon.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending}>
            {template ? "Opslaan" : "Aanmaken"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Consent tab ─────────────────────────────────────────────────────────────

function ConsentTab() {
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
          {consents?.length ?? 0} kandidaten · Verwerk alleen kandidaten met
          status &quot;Toestemming&quot;.
        </p>
        <Button onClick={() => setInviteOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Uitnodigen
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
                    <th className="px-4 py-2">Kandidaat</th>
                    <th className="px-4 py-2">Telefoon</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Bron</th>
                    <th className="px-4 py-2">Sinds</th>
                    <th className="px-4 py-2 text-right">Acties</th>
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
                            {pill.label}
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
                              Intrekken
                            </Button>
                          )}
                          {(c.status === "pending" || c.status === "withdrawn") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setInviteOpen(true)}
                              className="h-7 text-xs"
                            >
                              Opnieuw uitnodigen
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
  const { toast } = useToast();
  const invite = useInviteWhatsAppConsent();
  const [candidateId, setCandidateId] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"template" | "email">("template");
  const { data: candidates, isLoading: candidatesLoading } = useCandidates();

  const candidate = (candidates ?? []).find((c) => c.id === candidateId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Opt-in uitnodigen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Kandidaat</Label>
            <Select value={candidateId} onValueChange={(v) => {
              setCandidateId(v);
              const c = (candidates ?? []).find((x) => x.id === v);
              setPhone(c?.phone ?? "");
            }}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    candidatesLoading
                      ? "Kandidaten laden..."
                      : !candidates || candidates.length === 0
                        ? "Geen kandidaten beschikbaar"
                        : "Kies een kandidaat…"
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
            <Label htmlFor="invite-phone">Telefoonnummer</Label>
            <Input
              id="invite-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+31 6 1234 5678"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Verzendmethode</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod("template")}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  method === "template"
                    ? "border-emerald-500 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40"
                    : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                )}
              >
                <MessageCircle className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div>
                  <p className="text-xs font-semibold">WhatsApp-template</p>
                  <p className="text-[10px] text-muted-foreground">
                    Snelle conversie, lage drempel.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMethod("email")}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  method === "email"
                    ? "border-indigo-500 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                    : "border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                )}
              >
                <Mail className="mt-0.5 h-4 w-4 text-indigo-600" />
                <div>
                  <p className="text-xs font-semibold">E-mail link</p>
                  <p className="text-[10px] text-muted-foreground">
                    Werkt zonder bestaand WA-contact.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button
            disabled={!candidateId || !phone}
            onClick={async () => {
              await invite.mutateAsync({
                candidate_id: candidateId,
                phone_number: phone,
                candidate_name: candidate?.name,
              });
              toast({
                title: "Uitnodiging verstuurd",
                description:
                  method === "template"
                    ? "WhatsApp-template afgeleverd."
                    : "E-mail met opt-in link verzonden.",
              });
              onClose();
            }}
          >
            Versturen
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
  const { toast } = useToast();
  const withdraw = useWithdrawWhatsAppConsent();
  const [reason, setReason] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Toestemming intrekken</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Intrekken voor <strong>{candidateName ?? candidateId}</strong>. Dit
          wordt vastgelegd in de audit-trail.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reden (verplicht)"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuleren
          </Button>
          <Button
            disabled={!reason.trim()}
            variant="destructive"
            onClick={async () => {
              await withdraw.mutateAsync({
                candidate_id: candidateId,
                reason: reason.trim(),
              });
              toast({ title: "Toestemming ingetrokken" });
              onClose();
            }}
          >
            Intrekken
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Messages tab ────────────────────────────────────────────────────────────

function MessagesTab() {
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
            Nog geen WhatsApp-berichten verzonden.
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
                      {m.direction === "outbound" ? "→ Verzonden" : "← Ontvangen"} ·{" "}
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
