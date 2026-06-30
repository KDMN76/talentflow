"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Webhook as WebhookIcon,
  Plus,
  Power,
  Trash2,
  Send,
  Eye,
  RotateCcw,
  Copy,
  KeyRound,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Skull,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import {
  useWebhookSubscriptions,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
  useRotateWebhookSecret,
  useWebhookDeliveries,
  useDeliveryDetails,
  useRetryDelivery,
  useTestWebhook,
  useWebhookEventTypes,
  type DeliveryStatus,
  type Webhook as WebhookType,
} from "@/hooks/useWebhooks";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined, t: TFunction): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return t("webhooks.relative.justNow");
  if (diff < 3_600_000) return t("webhooks.relative.minutesAgo", { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("webhooks.relative.hoursAgo", { count: Math.floor(diff / 3_600_000) });
  return d.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}

function StatusBadge({ status }: { status: DeliveryStatus }) {
  const { t } = useTranslation("miscDev");
  const config: Record<
    DeliveryStatus,
    { className: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    succeeded: {
      className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400",
      icon: CheckCircle2,
    },
    failed: {
      className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
      icon: XCircle,
    },
    dead: {
      className: "bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900",
      icon: Skull,
    },
    pending: {
      className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      icon: Clock,
    },
    delivering: {
      className: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
      icon: Loader2,
    },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <Badge className={`${c.className} gap-1`}>
      <Icon className={`h-3 w-3 ${status === "delivering" ? "animate-spin" : ""}`} />
      {t(`webhooks.deliveryStatus.${status}`)}
    </Badge>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function WebhooksPage() {
  const { t } = useTranslation("miscDev");
  const { toast } = useToast();

  // Subscriptions
  const { data: subscriptions = [], isLoading: subsLoading } = useWebhookSubscriptions();
  const createSub = useCreateWebhook();
  const updateSub = useUpdateWebhook();
  const deleteSub = useDeleteWebhook();
  const toggleSub = useToggleWebhook();
  const rotateSecret = useRotateWebhookSecret();

  // Deliveries
  const [filterSub, setFilterSub] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<DeliveryStatus | "">("");
  const filters = useMemo(
    () => ({
      ...(filterSub ? { subscription_id: filterSub } : {}),
      ...(filterStatus ? { status: filterStatus as DeliveryStatus } : {}),
      limit: 100,
    }),
    [filterSub, filterStatus]
  );
  const { data: deliveries = [], isLoading: delLoading } = useWebhookDeliveries(filters);
  const retryDelivery = useRetryDelivery();

  // Event types
  const { data: eventTypes = [] } = useWebhookEventTypes();

  // UI state
  const [createOpen, setCreateOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Test tool
  const testWebhook = useTestWebhook();
  const [testUrl, setTestUrl] = useState("");
  const [testEvent, setTestEvent] = useState("candidate.created");
  const [testPayload, setTestPayload] = useState(
    JSON.stringify(
      {
        candidate: { id: "demo", name: "Jan Jansen", email: "jan@example.com" },
      },
      null,
      2
    )
  );
  const [testResult, setTestResult] = useState<null | {
    status: number | null;
    duration_ms: number;
    error: string | null;
    signature: string;
    response_body: string | null;
  }>(null);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("webhooks.header.title")}
        description={t("webhooks.header.description")}
      />

      <Tabs defaultValue="subscriptions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="subscriptions">{t("webhooks.tabs.subscriptions")}</TabsTrigger>
          <TabsTrigger value="deliveries">{t("webhooks.tabs.deliveries")}</TabsTrigger>
          <TabsTrigger value="test">{t("webhooks.tabs.test")}</TabsTrigger>
        </TabsList>

        {/* ── Subscriptions ───────────────────────────────────────────────── */}
        <TabsContent value="subscriptions" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("webhooks.subscriptions.count", { count: subscriptions.length })}
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("webhooks.subscriptions.new")}
            </Button>
          </div>

          {subsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : subscriptions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <WebhookIcon className="mx-auto h-10 w-10 mb-3 opacity-40" />
                {t("webhooks.subscriptions.emptyLine1")} &ldquo;{t("webhooks.subscriptions.emptyLink")}&rdquo; {t("webhooks.subscriptions.emptyLine2")}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {subscriptions.map((sub) => (
                <SubscriptionRow
                  key={sub.id}
                  sub={sub}
                  onToggle={async () => {
                    await toggleSub.mutateAsync(sub.id);
                  }}
                  onDelete={async () => {
                    if (!confirm(t("webhooks.subscriptions.confirmDelete", { name: sub.name }))) return;
                    await deleteSub.mutateAsync(sub.id);
                    toast({ title: t("webhooks.toasts.deleted") });
                  }}
                  onRotate={async () => {
                    if (!confirm(t("webhooks.subscriptions.confirmRotate"))) return;
                    const result = await rotateSecret.mutateAsync(sub.id);
                    setCreatedSecret({ name: sub.name, secret: result.secret });
                  }}
                  onUpdate={async (patch) => {
                    await updateSub.mutateAsync({ id: sub.id, patch });
                    toast({ title: t("webhooks.toasts.updated") });
                  }}
                  eventTypes={eventTypes}
                />
              ))}
            </div>
          )}

          <CreateSubscriptionDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            eventTypes={eventTypes}
            onCreate={async (input) => {
              try {
                const result = await createSub.mutateAsync(input);
                setCreateOpen(false);
                if (result.secret) {
                  setCreatedSecret({ name: result.name, secret: result.secret });
                }
                toast({ title: t("webhooks.toasts.created") });
              } catch {
                toast({
                  title: t("webhooks.toasts.createErrorTitle"),
                  description: t("webhooks.toasts.createErrorDescription"),
                  variant: "destructive",
                });
              }
            }}
          />

          <SecretDisplayDialog
            value={createdSecret}
            onClose={() => setCreatedSecret(null)}
          />
        </TabsContent>

        {/* ── Deliveries ──────────────────────────────────────────────────── */}
        <TabsContent value="deliveries" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="filter-sub">{t("webhooks.deliveries.subscriptionLabel")}</Label>
              <select
                id="filter-sub"
                value={filterSub}
                onChange={(e) => setFilterSub(e.target.value)}
                className="h-10 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">{t("webhooks.deliveries.all")}</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-status">{t("webhooks.deliveries.statusLabel")}</Label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as DeliveryStatus | "")}
                className="h-10 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">{t("webhooks.deliveries.all")}</option>
                <option value="succeeded">{t("webhooks.deliveryStatus.succeeded")}</option>
                <option value="failed">{t("webhooks.deliveryStatus.failed")}</option>
                <option value="pending">{t("webhooks.deliveryStatus.pending")}</option>
                <option value="dead">{t("webhooks.deliveryStatus.dead")}</option>
              </select>
            </div>
          </div>

          {delLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : deliveries.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {t("webhooks.deliveries.empty")}
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.time")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.event")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.subscription")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.status")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.attempt")}</th>
                    <th className="px-4 py-3 text-left font-medium">{t("webhooks.deliveries.columns.response")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("webhooks.deliveries.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => {
                    const sub = subscriptions.find((s) => s.id === d.subscription_id);
                    return (
                      <tr key={d.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3 whitespace-nowrap">{formatRelative(d.created_at, t)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{d.event_type}</td>
                        <td className="px-4 py-3">{sub?.name ?? d.subscription_id.slice(0, 8)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={d.status} />
                        </td>
                        <td className="px-4 py-3">{d.attempt}/5</td>
                        <td className="px-4 py-3">
                          {d.response_status ? (
                            <span
                              className={
                                d.response_status >= 200 && d.response_status < 300
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }
                            >
                              {d.response_status}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setDetailId(d.id)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {(d.status === "failed" || d.status === "dead") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  await retryDelivery.mutateAsync(d.id);
                                  toast({ title: t("webhooks.toasts.retryStarted") });
                                }}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DeliveryDetailDialog
            id={detailId}
            onClose={() => setDetailId(null)}
            onRetry={async (id) => {
              await retryDelivery.mutateAsync(id);
              toast({ title: t("webhooks.toasts.retryStarted") });
            }}
          />
        </TabsContent>

        {/* ── Test tool ───────────────────────────────────────────────────── */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("webhooks.test.title")}</CardTitle>
              <CardDescription>
                {t("webhooks.test.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="test-url">{t("webhooks.test.targetUrlLabel")}</Label>
                <Input
                  id="test-url"
                  type="url"
                  placeholder={t("webhooks.test.targetUrlPlaceholder")}
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="test-event">{t("webhooks.test.eventTypeLabel")}</Label>
                <select
                  id="test-event"
                  value={testEvent}
                  onChange={(e) => setTestEvent(e.target.value)}
                  className="h-10 rounded-md border bg-transparent px-3 text-sm w-full"
                >
                  {(eventTypes.length > 0 ? eventTypes : ["candidate.created"]).map((evt) => (
                    <option key={evt} value={evt}>
                      {evt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="test-payload">{t("webhooks.test.payloadLabel")}</Label>
                <textarea
                  id="test-payload"
                  rows={8}
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
                />
              </div>
              <Button
                onClick={async () => {
                  let payload: Record<string, unknown> = {};
                  try {
                    payload = JSON.parse(testPayload);
                  } catch {
                    toast({
                      title: t("webhooks.test.invalidJsonTitle"),
                      description: t("webhooks.test.invalidJsonDescription"),
                      variant: "destructive",
                    });
                    return;
                  }
                  if (!testUrl) {
                    toast({
                      title: t("webhooks.test.urlMissingTitle"),
                      variant: "destructive",
                    });
                    return;
                  }
                  const result = await testWebhook.mutateAsync({
                    url: testUrl,
                    event_type: testEvent,
                    payload,
                  });
                  setTestResult(result);
                }}
                disabled={testWebhook.isPending}
              >
                {testWebhook.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {t("webhooks.test.send")}
              </Button>

              {testResult && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t("webhooks.test.result.statusLabel")}</span>
                    {testResult.status ? (
                      <Badge
                        className={
                          testResult.status >= 200 && testResult.status < 300
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }
                      >
                        {t("webhooks.test.result.httpStatus", { status: testResult.status })}
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700">{t("webhooks.test.result.noResponse")}</Badge>
                    )}
                    <span className="text-muted-foreground">
                      {t("webhooks.test.result.durationMs", { duration: testResult.duration_ms })}
                    </span>
                  </div>
                  {testResult.error && (
                    <div className="flex items-start gap-2 text-red-600">
                      <AlertTriangle className="h-4 w-4 mt-0.5" />
                      <span>{testResult.error}</span>
                    </div>
                  )}
                  <div className="text-xs">
                    <span className="font-medium">{t("webhooks.test.result.signatureLabel")}</span>
                    <code className="break-all">{testResult.signature}</code>
                  </div>
                  {testResult.response_body && (
                    <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-48">
                      {testResult.response_body}
                    </pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Components ──────────────────────────────────────────────────────────────

function SubscriptionRow({
  sub,
  onToggle,
  onDelete,
  onRotate,
  onUpdate,
  eventTypes,
}: {
  sub: WebhookType;
  onToggle: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRotate: () => Promise<void>;
  onUpdate: (patch: Partial<Pick<WebhookType, "name" | "url" | "events" | "description">>) => Promise<void>;
  eventTypes: string[];
}) {
  const { t } = useTranslation("miscDev");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const [url, setUrl] = useState(sub.url);
  const [description, setDescription] = useState(sub.description ?? "");
  const [events, setEvents] = useState<string[]>(sub.events);

  const failing = (sub.failure_count ?? 0) > 5;

  return (
    <Card className={!sub.active ? "opacity-60" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-muted-foreground"
            aria-label={t("webhooks.subscriptionRow.toggleDetailsAria")}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{sub.name}</h3>
              {sub.active ? (
                <Badge className="bg-emerald-100 text-emerald-700">{t("webhooks.subscriptionRow.active")}</Badge>
              ) : (
                <Badge variant="secondary">{t("webhooks.subscriptionRow.off")}</Badge>
              )}
              {failing && (
                <Badge className="bg-amber-100 text-amber-700 gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t("webhooks.subscriptionRow.failedCount", { count: sub.failure_count })}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate mt-1">{sub.url}</p>
            {sub.description && (
              <p className="text-sm text-muted-foreground mt-1">{sub.description}</p>
            )}
            <div className="flex flex-wrap gap-1 mt-2">
              {sub.events.map((e) => (
                <Badge key={e} variant="outline" className="font-mono text-xs">
                  {e}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={onToggle}>
              <Power className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onRotate} title={t("webhooks.subscriptionRow.rotateSecretTitle")}>
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">{t("webhooks.subscriptionRow.lastDelivery")}</span>{" "}
                {formatRelative(sub.last_delivered_at, t)}
              </div>
              <div>
                <span className="text-muted-foreground">{t("webhooks.subscriptionRow.lastFailure")}</span>{" "}
                {formatRelative(sub.last_failure_at, t)}
              </div>
            </div>
            {!editing ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t("webhooks.subscriptionRow.edit")}
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                <div className="space-y-1">
                  <Label>{t("webhooks.subscriptionRow.nameLabel")}</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("webhooks.subscriptionRow.urlLabel")}</Label>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("webhooks.subscriptionRow.descriptionLabel")}</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t("webhooks.subscriptionRow.eventsLabel")}</Label>
                  <EventMultiSelect
                    available={eventTypes}
                    selected={events}
                    onChange={setEvents}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      await onUpdate({ name, url, description, events });
                      setEditing(false);
                    }}
                  >
                    {t("webhooks.subscriptionRow.save")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    {t("webhooks.subscriptionRow.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventMultiSelect({
  available,
  selected,
  onChange,
}: {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation("miscDev");
  const list = available.length > 0 ? available : selected;
  return (
    <div className="rounded-md border p-2 bg-background max-h-44 overflow-y-auto space-y-1">
      {list.map((evt) => (
        <label key={evt} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(evt)}
            onChange={(e) => {
              if (e.target.checked) onChange([...selected, evt]);
              else onChange(selected.filter((v) => v !== evt));
            }}
          />
          <span className="font-mono">{evt}</span>
        </label>
      ))}
      <label className="flex items-center gap-2 text-xs cursor-pointer pt-1 border-t">
        <input
          type="checkbox"
          checked={selected.includes("*")}
          onChange={(e) => {
            if (e.target.checked) onChange([...selected, "*"]);
            else onChange(selected.filter((v) => v !== "*"));
          }}
        />
        <span className="font-mono">{t("webhooks.eventSelect.allEvents")}</span>
      </label>
    </div>
  );
}

function CreateSubscriptionDialog({
  open,
  onOpenChange,
  eventTypes,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventTypes: string[];
  onCreate: (input: {
    name: string;
    url: string;
    description?: string;
    events: string[];
  }) => Promise<void>;
}) {
  const { t } = useTranslation("miscDev");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("webhooks.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("webhooks.createDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("webhooks.createDialog.nameLabel")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("webhooks.createDialog.namePlaceholder")} />
          </div>
          <div className="space-y-1">
            <Label>{t("webhooks.createDialog.urlLabel")}</Label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("webhooks.createDialog.urlPlaceholder")}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("webhooks.createDialog.descriptionLabel")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("webhooks.createDialog.eventsLabel")}</Label>
            <EventMultiSelect available={eventTypes} selected={events} onChange={setEvents} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("webhooks.createDialog.cancel")}
          </Button>
          <Button
            onClick={async () => {
              if (!name || !url || events.length === 0) return;
              setSubmitting(true);
              try {
                await onCreate({ name, url, description: description || undefined, events });
                setName("");
                setUrl("");
                setDescription("");
                setEvents([]);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting || !name || !url || events.length === 0}
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t("webhooks.createDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretDisplayDialog({
  value,
  onClose,
}: {
  value: { name: string; secret: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("miscDev");
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("webhooks.secretDialog.title", { name: value?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("webhooks.secretDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 font-mono text-sm break-all">
          {value?.secret}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (value) navigator.clipboard.writeText(value.secret);
            }}
          >
            <Copy className="h-4 w-4 mr-2" />
            {t("webhooks.secretDialog.copy")}
          </Button>
          <Button onClick={onClose}>{t("webhooks.secretDialog.understood")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryDetailDialog({
  id,
  onClose,
  onRetry,
}: {
  id: string | null;
  onClose: () => void;
  onRetry: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation("miscDev");
  const { data, isLoading } = useDeliveryDetails(id);
  const [showReqBody, setShowReqBody] = useState(true);
  const [showResBody, setShowResBody] = useState(true);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("webhooks.detailDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("webhooks.detailDialog.description")}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("webhooks.detailDialog.eventLabel")}</Label>
                <p className="font-mono text-xs">{data.event_type}</p>
              </div>
              <div>
                <Label>{t("webhooks.detailDialog.statusLabel")}</Label>
                <div>
                  <StatusBadge status={data.status} />
                </div>
              </div>
              <div>
                <Label>{t("webhooks.detailDialog.attemptLabel")}</Label>
                <p>{data.attempt}/5</p>
              </div>
              <div>
                <Label>{t("webhooks.detailDialog.durationLabel")}</Label>
                <p>{data.duration_ms ? `${data.duration_ms}ms` : "—"}</p>
              </div>
            </div>

            {data.error_message && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-red-700 dark:text-red-400">
                <strong>{t("webhooks.detailDialog.errorLabel")}</strong> {data.error_message}
              </div>
            )}

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowReqBody((v) => !v)}
                className="flex items-center gap-2 font-medium"
              >
                {showReqBody ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {t("webhooks.detailDialog.request")} {data.request_url}
              </button>
              {showReqBody && (
                <>
                  {data.request_headers && (
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto">
                      {JSON.stringify(data.request_headers, null, 2)}
                    </pre>
                  )}
                  {data.request_body && (
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto max-h-72">
                      {data.request_body}
                    </pre>
                  )}
                </>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowResBody((v) => !v)}
                className="flex items-center gap-2 font-medium"
              >
                {showResBody ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {t("webhooks.detailDialog.response")} {data.response_status ? `← ${data.response_status}` : ""}
              </button>
              {showResBody && (
                <>
                  {data.response_headers && (
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto">
                      {JSON.stringify(data.response_headers, null, 2)}
                    </pre>
                  )}
                  {data.response_body !== null ? (
                    <pre className="text-xs bg-muted/50 p-3 rounded overflow-x-auto max-h-72">
                      {data.response_body}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("webhooks.detailDialog.noResponse")}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          {data && (data.status === "failed" || data.status === "dead") && (
            <Button
              onClick={async () => {
                await onRetry(data.id);
                onClose();
              }}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("webhooks.detailDialog.retry")}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t("webhooks.detailDialog.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
