"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Mail,
  ShieldCheck,
  Trash2,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useDisconnectIntegration,
  useMailboxIntegrations,
  useStartOAuth,
  type MailboxIntegration,
  type MailboxProvider,
} from "@/hooks/useMailboxIntegrations";

// ─── Provider metadata ──────────────────────────────────────────────────────

interface ProviderMeta {
  id: MailboxProvider;
  name: string;
  descriptionKey: string;
  hourlyLimit: number;
  Logo: React.FC<{ className?: string }>;
  accent: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gmail",
    name: "Gmail",
    descriptionKey: "providers.gmailDescription",
    hourlyLimit: 250,
    Logo: GmailLogo,
    accent: "from-red-500 to-amber-500",
  },
  {
    id: "outlook",
    name: "Outlook",
    descriptionKey: "providers.outlookDescription",
    hourlyLimit: 100,
    Logo: OutlookLogo,
    accent: "from-blue-500 to-indigo-600",
  },
];

// ─── Page component ─────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { t } = useTranslation("settingsIntegrations");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const {
    data: integrations,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useMailboxIntegrations();
  const startOAuth = useStartOAuth();
  const disconnect = useDisconnectIntegration();

  const [pendingProvider, setPendingProvider] = useState<MailboxProvider | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState<MailboxIntegration | null>(
    null
  );

  // ─── OAuth callback handling ────────────────────────────────────────────
  useEffect(() => {
    const status = searchParams.get("status");
    if (!status) return;

    if (status === "success") {
      toast({
        title: t("toasts.connected.title"),
        description: t("toasts.connected.description"),
      });
      refetch();
    } else if (status === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      toast({
        title: t("toasts.connectFailed.title"),
        description: t([`errorReasons.${reason}`, "errorReasons.unknown"]),
        variant: "destructive",
      });
    }

    // Clean the URL so a refresh doesn't re-fire the toast.
    const cleanUrl = window.location.pathname;
    router.replace(cleanUrl);
    // We intentionally only run on the initial searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = integrations ?? [];
    const connected = list.length;
    const synced24h = list.reduce(
      (sum, integ) => sum + (integ.emails_synced_24h ?? 0),
      0
    );
    return { connected, synced24h };
  }, [integrations]);

  const grouped = useMemo(() => {
    const list = integrations ?? [];
    return PROVIDERS.map((p) => ({
      meta: p,
      accounts: list.filter((m) => m.provider === p.id),
    }));
  }, [integrations]);

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleConnect = async (provider: MailboxProvider) => {
    setPendingProvider(provider);
    try {
      const result = await startOAuth.mutateAsync(provider);
      // OAuth handshake leaves the SPA — full page redirect.
      window.location.href = result.url;
    } catch {
      toast({
        title: t("toasts.oauthFailed.title"),
        description: t("toasts.oauthFailed.description"),
        variant: "destructive",
      });
      setPendingProvider(null);
    }
  };

  const handleDisconnect = async (integ: MailboxIntegration) => {
    try {
      await disconnect.mutateAsync(integ.id);
      toast({
        title: t("toasts.disconnected.title"),
        description: t("toasts.disconnected.description", {
          email: integ.account_email,
        }),
      });
    } catch {
      toast({
        title: t("toasts.disconnectFailed.title"),
        description: t("toasts.disconnectFailed.description"),
        variant: "destructive",
      });
    } finally {
      setConfirmDelete(null);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl space-y-6 animate-fade-in">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${isRefetching ? "animate-spin" : ""}`}
            />
            {t("header.refresh")}
          </Button>
        }
      />

      {/* ── Status cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("stats.connectedLabel")}
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {isLoading ? "—" : stats.connected}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.connected === 0
                ? t("stats.connectedEmpty")
                : t("stats.connectedActive")}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("stats.syncedLabel")}
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {isLoading ? "—" : stats.synced24h}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("stats.syncedHint")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Error state ── */}
      {isError && (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">
                {t("errorState.title")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("errorState.description")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Provider cards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {grouped.map(({ meta, accounts }) => (
          <ProviderCard
            key={meta.id}
            meta={meta}
            accounts={accounts}
            isLoading={isLoading}
            isConnecting={
              pendingProvider === meta.id || startOAuth.isPending
            }
            onConnect={() => handleConnect(meta.id)}
            onDisconnect={(integ) => setConfirmDelete(integ)}
          />
        ))}
      </div>

      {/* ── Scopes / privacy disclosure ── */}
      <Card className="border-0 shadow-sm bg-zinc-50/50 dark:bg-zinc-900/40">
        <Collapsible defaultOpen={false}>
          <div className="px-5 py-4 flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("disclosure.title")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("disclosure.description")}
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                {t("disclosure.details")}
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="border-t border-border px-5 py-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("scopes.gmailTitle")}
                </p>
                <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-1 font-mono">
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      gmail.send
                    </code>{" "}
                    {t("scopes.gmailSend")}
                  </li>
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      gmail.readonly
                    </code>{" "}
                    {t("scopes.gmailReadonly")}
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("scopes.outlookTitle")}
                </p>
                <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-1 font-mono">
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      Mail.Send
                    </code>{" "}
                    {t("scopes.outlookSend")}
                  </li>
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      Mail.Read
                    </code>{" "}
                    {t("scopes.outlookRead")}
                  </li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                {t("scopes.footer")}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ── Confirm disconnect ── */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disconnectDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  <span className="font-medium">{confirmDelete.account_email}</span>{" "}
                  {t("disconnectDialog.body")}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("disconnectDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDisconnect(confirmDelete)}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {t("disconnectDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Provider card component ────────────────────────────────────────────────

interface ProviderCardProps {
  meta: ProviderMeta;
  accounts: MailboxIntegration[];
  isLoading: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: (integ: MailboxIntegration) => void;
}

function ProviderCard({
  meta,
  accounts,
  isLoading,
  isConnecting,
  onConnect,
  onDisconnect,
}: ProviderCardProps) {
  const { t } = useTranslation("settingsIntegrations");
  const { Logo } = meta;
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-3">
          <div
            className={`h-11 w-11 rounded-xl bg-gradient-to-br ${meta.accent} flex items-center justify-center shadow-sm`}
          >
            <Logo className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{meta.name}</CardTitle>
            <CardDescription className="text-xs">
              {t("providerCard.limit", { limit: meta.hourlyLimit })}
            </CardDescription>
          </div>
          {accounts.length > 0 && (
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0 text-[10px]">
              {t("providerCard.connectedBadge", { count: accounts.length })}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t(meta.descriptionKey)}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Account list */}
        {isLoading ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            {t("providerCard.loading")}
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <Mail className="h-5 w-5 text-muted-foreground/60 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              {t("providerCard.emptyAccount", { name: meta.name })}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-start justify-between gap-3 px-3.5 py-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {acc.account_email}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {acc.account_name && (
                      <span className="mr-2">{acc.account_name}</span>
                    )}
                    {t("providerCard.lastSync")}{" "}
                    {acc.last_sync_at
                      ? formatRelative(acc.last_sync_at, t)
                      : t("providerCard.notYet")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDisconnect(acc)}
                  className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-1.5" />
                  {t("providerCard.disconnect")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Connect button */}
        <Button
          onClick={onConnect}
          disabled={isConnecting}
          className="w-full bg-zinc-900 hover:bg-zinc-800 text-white border-0 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isConnecting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          {t("providerCard.connectButton", { name: meta.name })}
          <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string, t: TFunction): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("relative.justNow");
  if (mins < 60) return t("relative.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("relative.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("relative.daysAgo", { count: days });
  return date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Brand logos (inline SVG to avoid extra deps) ───────────────────────────

function GmailLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M2 6.5C2 5.12 3.12 4 4.5 4h15C20.88 4 22 5.12 22 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-15C3.12 20 2 18.88 2 17.5v-11Zm2.4-.5L12 11.65 19.6 6H4.4ZM20 8.27l-7.43 5.51a1 1 0 0 1-1.14 0L4 8.27V17.5c0 .28.22.5.5.5h15c.28 0 .5-.22.5-.5V8.27Z" />
    </svg>
  );
}

function OutlookLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M8.5 5.5C5.74 5.5 3.5 8.41 3.5 12s2.24 6.5 5 6.5 5-2.91 5-6.5-2.24-6.5-5-6.5Zm0 10.5c-1.66 0-3-1.79-3-4s1.34-4 3-4 3 1.79 3 4-1.34 4-3 4Zm6.5-9h6v2h-6V7Zm0 3.5h6v2h-6v-2Zm0 3.5h6v2h-6v-2Zm0 3.5h6v2h-6v-2Z" />
    </svg>
  );
}
