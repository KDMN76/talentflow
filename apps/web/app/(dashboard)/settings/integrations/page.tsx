"use client";

import { useEffect, useMemo, useState } from "react";
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

// ─── OAuth callback reasons ─────────────────────────────────────────────────

const ERROR_REASONS: Record<string, string> = {
  access_denied: "Toestemming geweigerd. Probeer het opnieuw en sta de gevraagde rechten toe.",
  invalid_state: "OAuth-sessie verlopen. Start de koppeling opnieuw.",
  token_exchange_failed: "Token-uitwisseling met de provider mislukte.",
  scope_missing: "Niet alle benodigde rechten zijn verleend.",
  unknown: "Er ging iets mis bij het verbinden.",
};

// ─── Provider metadata ──────────────────────────────────────────────────────

interface ProviderMeta {
  id: MailboxProvider;
  name: string;
  description: string;
  hourlyLimit: number;
  Logo: React.FC<{ className?: string }>;
  accent: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "gmail",
    name: "Gmail",
    description:
      "Verbind je Gmail om mails direct vanuit TalentFlow te versturen en replies automatisch in te lezen.",
    hourlyLimit: 250,
    Logo: GmailLogo,
    accent: "from-red-500 to-amber-500",
  },
  {
    id: "outlook",
    name: "Outlook",
    description:
      "Verbind je Microsoft 365 / Outlook-postvak om vanuit TalentFlow te corresponderen.",
    hourlyLimit: 100,
    Logo: OutlookLogo,
    accent: "from-blue-500 to-indigo-600",
  },
];

// ─── Page component ─────────────────────────────────────────────────────────

export default function IntegrationsPage() {
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
        title: "Mailbox verbonden",
        description:
          "Je e-mailaccount is gekoppeld aan TalentFlow en kan nu gebruikt worden voor verzending.",
      });
      refetch();
    } else if (status === "error") {
      const reason = searchParams.get("reason") ?? "unknown";
      toast({
        title: "Verbinden mislukt",
        description: ERROR_REASONS[reason] ?? ERROR_REASONS.unknown,
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
        title: "Kon OAuth niet starten",
        description: "Probeer het later opnieuw of neem contact op met support.",
        variant: "destructive",
      });
      setPendingProvider(null);
    }
  };

  const handleDisconnect = async (integ: MailboxIntegration) => {
    try {
      await disconnect.mutateAsync(integ.id);
      toast({
        title: "Mailbox losgekoppeld",
        description: `${integ.account_email} is niet meer verbonden.`,
      });
    } catch {
      toast({
        title: "Loskoppelen mislukt",
        description: "Probeer het opnieuw.",
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
        title="Integraties — koppel je mailbox aan TalentFlow"
        description="Verbind Gmail of Outlook om mails direct vanuit TalentFlow te versturen en replies automatisch in te lezen."
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
            Vernieuwen
          </Button>
        }
      />

      {/* ── Status cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Verbonden mailboxes
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {isLoading ? "—" : stats.connected}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.connected === 0
                ? "Nog geen mailboxes gekoppeld"
                : "Actief en klaar voor verzending"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Emails gesynced (24u)
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {isLoading ? "—" : stats.synced24h}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Inkomende + uitgaande mails via gekoppelde accounts
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
                Integraties konden niet worden geladen
              </p>
              <p className="text-xs text-muted-foreground">
                Controleer je verbinding en probeer het opnieuw.
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
                We krijgen alleen toegang tot mails versturen + lezen
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Geen agenda, geen contacten, geen Drive-bestanden. Tokens worden
                versleuteld opgeslagen en kun je elk moment intrekken.
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                Details
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="border-t border-border px-5 py-4 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Gmail-scopes
                </p>
                <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-1 font-mono">
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      gmail.send
                    </code>{" "}
                    — versturen namens jouw account
                  </li>
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      gmail.readonly
                    </code>{" "}
                    — alleen lezen om replies van kandidaten te koppelen
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Outlook-scopes
                </p>
                <ul className="text-xs text-zinc-700 dark:text-zinc-300 space-y-1 font-mono">
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      Mail.Send
                    </code>{" "}
                    — versturen namens jouw account
                  </li>
                  <li>
                    <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                      Mail.Read
                    </code>{" "}
                    — alleen lezen om replies van kandidaten te koppelen
                  </li>
                </ul>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Tokens worden versleuteld opgeslagen (AES-256-GCM) en
                nooit gedeeld met derden. Bij &quot;Disconnect&quot; verwijderen we het
                token onmiddellijk uit onze database.
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
            <AlertDialogTitle>Mailbox loskoppelen?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  <span className="font-medium">{confirmDelete.account_email}</span>{" "}
                  wordt losgekoppeld. Lopende campagnes via dit account worden
                  gepauzeerd. Je kunt later opnieuw verbinden.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDisconnect(confirmDelete)}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Loskoppelen
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
              Limiet: {meta.hourlyLimit} mails/uur
            </CardDescription>
          </div>
          {accounts.length > 0 && (
            <Badge className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-0 text-[10px]">
              {accounts.length} verbonden
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Account list */}
        {isLoading ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Laden…
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <Mail className="h-5 w-5 text-muted-foreground/60 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              Nog geen {meta.name}-account verbonden.
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
                    Laatste sync:{" "}
                    {acc.last_sync_at
                      ? formatRelative(acc.last_sync_at)
                      : "nog niet"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onDisconnect(acc)}
                  className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-1.5" />
                  Disconnect
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
          Verbind {meta.name}-account
          <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} dag${days === 1 ? "" : "en"} geleden`;
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
