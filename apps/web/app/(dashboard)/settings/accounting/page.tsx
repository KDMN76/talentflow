"use client";

/**
 * Sprint Q4.4 — Boekhoudkoppelingen instellen.
 *
 * - Catalog van 3 providers: Exact Online, Twinfield, SnelStart.
 * - OAuth-flow (mock) of API-key form afhankelijk van auth_type.
 * - Connected state: last_synced_at, last_error, disconnect.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  useAccountingCatalog,
  useAccountingIntegrations,
  useConnectAccounting,
  useDisconnectAccounting,
} from "@/hooks/useBackOffice";
import type {
  AccountingCatalogEntry,
  AccountingProvider,
} from "@/lib/types/backOffice";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AccountingSettingsPage() {
  const { t } = useTranslation("settingsAdvanced");
  const { toast } = useToast();
  const { data: catalog, isLoading } = useAccountingCatalog();
  const { data: integrations } = useAccountingIntegrations();
  const connect = useConnectAccounting();
  const disconnect = useDisconnectAccounting();

  const [connectFor, setConnectFor] = useState<AccountingCatalogEntry | null>(
    null
  );
  const [disconnectFor, setDisconnectFor] =
    useState<AccountingProvider | null>(null);

  const integrationByProvider = useMemo(() => {
    const map = new Map<AccountingProvider, ReturnType<typeof getInt>>();
    function getInt(p: AccountingProvider) {
      return integrations?.find((i) => i.provider === p) ?? null;
    }
    (catalog ?? []).forEach((c) => {
      map.set(c.provider, getInt(c.provider));
    });
    return map;
  }, [catalog, integrations]);

  const handleDisconnect = async () => {
    if (!disconnectFor) return;
    try {
      await disconnect.mutateAsync(disconnectFor);
      toast({
        title: t("accounting.toast.disconnected.title"),
        description: t("accounting.toast.disconnected.description"),
      });
      setDisconnectFor(null);
    } catch {
      toast({
        title: t("accounting.toast.disconnectFailed.title"),
        variant: "destructive",
      });
    }
  };

  const handleConnect = async (
    provider: AccountingProvider,
    payload: Record<string, unknown>
  ) => {
    try {
      await connect.mutateAsync({ provider, payload });
      toast({
        title: t("accounting.toast.connected.title"),
        description: t("accounting.toast.connected.description"),
      });
      setConnectFor(null);
    } catch {
      toast({
        title: t("accounting.toast.connectFailed.title"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t("accounting.header.title")}
        description={t("accounting.header.description")}
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="h-48 p-6" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {(catalog ?? []).map((entry) => {
            const integration = integrationByProvider.get(entry.provider);
            const connected = integration?.status === "connected";
            const errored = integration?.status === "error";
            return (
              <Card
                key={entry.provider}
                className="flex flex-col border-0 shadow-sm transition hover:shadow-md"
              >
                <CardContent className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-base font-bold text-white shadow-md">
                      {entry.display_name.slice(0, 2).toUpperCase()}
                    </div>
                    {connected ? (
                      <Badge className="border-0 bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t("accounting.status.connected")}
                      </Badge>
                    ) : errored ? (
                      <Badge className="border-0 bg-red-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        {t("accounting.status.error")}
                      </Badge>
                    ) : (
                      <Badge className="border-0 bg-zinc-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {t("accounting.status.notConnected")}
                      </Badge>
                    )}
                  </div>

                  <div>
                    <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {entry.display_name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                  </div>

                  {connected && integration && (
                    <div className="space-y-2 rounded-lg bg-zinc-50/60 p-3 text-xs dark:bg-zinc-900/40">
                      <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                        <Clock className="h-3 w-3" />
                        {t("accounting.card.lastSync", {
                          date: formatDateTime(integration.last_synced_at),
                        })}
                      </div>
                      {integration.default_revenue_account && (
                        <div className="text-zinc-500">
                          {t("accounting.card.ledger", {
                            account: integration.default_revenue_account,
                            vat: integration.default_vat_code ?? "—",
                          })}
                        </div>
                      )}
                      {integration.last_error && (
                        <div className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{integration.last_error}</span>
                        </div>
                      )}
                      {!integration.last_error && (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <ShieldCheck className="h-3 w-3" />
                          {t("accounting.card.working")}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex items-center gap-2 pt-2">
                    {connected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDisconnectFor(entry.provider)}
                        className="w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t("accounting.actions.disconnect")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => setConnectFor(entry)}
                        className="w-full border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                      >
                        <Plug className="mr-1.5 h-3.5 w-3.5" />
                        {t("accounting.actions.connect")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Connect dialog */}
      <Dialog
        open={!!connectFor}
        onOpenChange={(open) => {
          if (!open) setConnectFor(null);
        }}
      >
        <DialogContent>
          {connectFor && (
            <ConnectForm
              entry={connectFor}
              onConnect={handleConnect}
              isPending={connect.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Disconnect confirm */}
      <AlertDialog
        open={!!disconnectFor}
        onOpenChange={(open) => {
          if (!open) setDisconnectFor(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("accounting.disconnectDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("accounting.disconnectDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("accounting.disconnectDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnect.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              )}
              {t("accounting.disconnectDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ConnectFormProps {
  entry: AccountingCatalogEntry;
  onConnect: (
    provider: AccountingProvider,
    payload: Record<string, unknown>
  ) => void;
  isPending: boolean;
}

function ConnectForm({ entry, onConnect, isPending }: ConnectFormProps) {
  const { t } = useTranslation("settingsAdvanced");
  const [revenueAccount, setRevenueAccount] = useState("8000");
  const [vatCode, setVatCode] = useState("VH-21");
  const [apiKey, setApiKey] = useState("");

  const isApiKey = entry.auth_type === "api_key";

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("accounting.connectForm.title", { provider: entry.display_name })}
        </DialogTitle>
        <DialogDescription>
          {isApiKey
            ? t("accounting.connectForm.descriptionApiKey")
            : t("accounting.connectForm.descriptionOAuth")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {isApiKey && (
          <div>
            <Label htmlFor="api-key">
              {t("accounting.connectForm.apiKeyLabel")}
            </Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_..."
                className="pl-9 font-mono text-xs"
              />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="rev-acct">
              {t("accounting.connectForm.revenueAccountLabel")}
            </Label>
            <Input
              id="rev-acct"
              value={revenueAccount}
              onChange={(e) => setRevenueAccount(e.target.value)}
              placeholder="8000"
            />
          </div>
          <div>
            <Label htmlFor="vat-code">
              {t("accounting.connectForm.vatCodeLabel")}
            </Label>
            <Input
              id="vat-code"
              value={vatCode}
              onChange={(e) => setVatCode(e.target.value)}
              placeholder="VH-21"
            />
          </div>
        </div>

        {!isApiKey && (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <ul className="space-y-1 text-indigo-800 dark:text-indigo-300">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("accounting.connectForm.oauthScope1")}
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("accounting.connectForm.oauthScope2")}
              </li>
            </ul>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          onClick={() =>
            onConnect(entry.provider, {
              api_key: isApiKey ? apiKey : undefined,
              oauth: !isApiKey ? "mock-handshake-success" : undefined,
              default_revenue_account: revenueAccount,
              default_vat_code: vatCode,
            })
          }
          disabled={isPending || (isApiKey && !apiKey)}
          className="border-0 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plug className="mr-1.5 h-4 w-4" />
          )}
          {isApiKey
            ? t("accounting.connectForm.submitApiKey")
            : t("accounting.connectForm.submitOAuth")}
        </Button>
      </DialogFooter>
    </>
  );
}
